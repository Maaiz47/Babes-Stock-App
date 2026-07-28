import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import {
  createMedication,
  getMedications,
  getSettings,
  tzNow,
  FREQUENCY_DEFAULT_TIMES,
  type FrequencyCode,
  type FoodInstruction,
  type MedicationInput,
} from '@/lib/meds';

export const dynamic = 'force-dynamic';

/**
 * Nothing reaches SQL that has not been through here. Anything not on this list
 * is rejected outright rather than quietly dropped, so a typo in the client
 * surfaces as a 400 instead of a silently-ignored field.
 */
const ALLOWED_KEYS = new Set([
  'name', 'strength', 'form', 'dose_label', 'frequency_code', 'times_of_day',
  'start_date', 'duration_days', 'min_gap_minutes', 'food_instruction', 'notes', 'color',
  'active', 'sort_order',
]);

const FREQUENCIES: FrequencyCode[] = ['OD', 'BD', 'TDS', 'QDS', 'CUSTOM'];
const FOODS: FoodInstruction[] = ['before_food', 'with_food', 'after_food', 'any'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A whole day is the practical ceiling: past that a "minimum gap" would defer a
// dose beyond the next one and start losing doses instead of spacing them.
const MAX_MIN_GAP_MINUTES = 24 * 60;


type Parsed = { ok: true; value: MedicationInput } | { ok: false; error: string };

function optionalText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCreate(raw: unknown, today: string, nextSortOrder: number): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, error: `Unknown field: ${key}` };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };

  const frequency_code = (body.frequency_code ?? 'OD') as FrequencyCode;
  if (!FREQUENCIES.includes(frequency_code)) {
    return { ok: false, error: `frequency_code must be one of ${FREQUENCIES.join(', ')}` };
  }

  // Absent times fall back to the standard clock for that frequency; a supplied
  // value is held to the full HH:MM contract.
  let times_of_day: string[];
  if (body.times_of_day === undefined) {
    times_of_day = [...FREQUENCY_DEFAULT_TIMES[frequency_code]];
  } else {
    if (!Array.isArray(body.times_of_day) || body.times_of_day.length === 0) {
      return { ok: false, error: 'times_of_day must be a non-empty array of HH:MM strings' };
    }
    for (const t of body.times_of_day) {
      if (typeof t !== 'string' || !TIME_RE.test(t)) {
        return { ok: false, error: `Invalid time in times_of_day: ${String(t)} (expected HH:MM)` };
      }
    }
    // De-duplicate: a dose is keyed by medication + scheduled instant, so a
    // repeated time yields two expected doses sharing one key. Adherence would
    // count it twice as expected but could only ever record one as taken,
    // capping her at less than 100% permanently.
    times_of_day = [...new Set(body.times_of_day as string[])];
  }

  const food_instruction = (body.food_instruction ?? 'any') as FoodInstruction;
  if (!FOODS.includes(food_instruction)) {
    return { ok: false, error: `food_instruction must be one of ${FOODS.join(', ')}` };
  }

  const start_date = body.start_date === undefined ? today : body.start_date;
  if (typeof start_date !== 'string' || !DATE_RE.test(start_date)) {
    return { ok: false, error: 'start_date must be YYYY-MM-DD' };
  }

  let duration_days: number | null = null;
  if (body.duration_days !== undefined && body.duration_days !== null) {
    const n = Number(body.duration_days);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: 'duration_days must be null or a positive integer' };
    }
    duration_days = n;
  }

  // null means "derive it from this medicine's own times" — the normal case.
  let min_gap_minutes: number | null = null;
  if (body.min_gap_minutes !== undefined && body.min_gap_minutes !== null) {
    const n = Number(body.min_gap_minutes);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_MIN_GAP_MINUTES) {
      return {
        ok: false,
        error: `min_gap_minutes must be null or a positive integer up to ${MAX_MIN_GAP_MINUTES}`,
      };
    }
    min_gap_minutes = n;
  }

  for (const key of ['form', 'dose_label', 'color'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') {
      return { ok: false, error: `${key} must be a string` };
    }
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    return { ok: false, error: 'active must be a boolean' };
  }
  if (body.sort_order !== undefined && !Number.isInteger(Number(body.sort_order))) {
    return { ok: false, error: 'sort_order must be an integer' };
  }

  return {
    ok: true,
    value: {
      name,
      strength: optionalText(body.strength),
      form: optionalText(body.form) ?? 'tablet',
      dose_label: optionalText(body.dose_label) ?? '1 tablet',
      frequency_code,
      times_of_day,
      start_date,
      duration_days,
      min_gap_minutes,
      food_instruction,
      notes: optionalText(body.notes),
      color: optionalText(body.color) ?? 'violet',
      active: body.active === undefined ? true : Boolean(body.active),
      sort_order: body.sort_order === undefined ? nextSortOrder : Number(body.sort_order),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const [settings, existing] = await Promise.all([
      getSettings(session.userId),
      getMedications(session.userId),
    ]);
    // New medicines land at the bottom of her list rather than jumping to the top.
    const nextSortOrder = existing.reduce((max, m) => Math.max(max, m.sort_order), 0) + 1;

    const parsed = parseCreate(raw, tzNow(settings.tz_offset_minutes).date, nextSortOrder);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const medication = await createMedication(session.userId, parsed.value);
    return NextResponse.json({ medication });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
