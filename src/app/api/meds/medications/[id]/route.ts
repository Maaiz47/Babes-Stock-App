import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import {
  updateMedication,
  deleteMedication,
  type FrequencyCode,
  type FoodInstruction,
  type MedicationInput,
} from '@/lib/meds';

export const dynamic = 'force-dynamic';

/** Same whitelist as the create route — unknown keys never reach SQL. */
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


/**
 * `id` comes straight off the URL. Postgres raises 22P02 on anything that is
 * not a UUID, which the catch below would turn into a 500 carrying the raw
 * driver text. A malformed id simply names no medicine of hers — 404.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Parsed = { ok: true; value: Partial<MedicationInput> } | { ok: false; error: string };

function optionalText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validates only the fields actually present — everything else is left alone. */
function parsePatch(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, error: `Unknown field: ${key}` };
  }

  const patch: Partial<MedicationInput> = {};

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { ok: false, error: 'name must be a non-empty string' };
    patch.name = name;
  }

  if ('frequency_code' in body) {
    const freq = body.frequency_code as FrequencyCode;
    if (!FREQUENCIES.includes(freq)) {
      return { ok: false, error: `frequency_code must be one of ${FREQUENCIES.join(', ')}` };
    }
    patch.frequency_code = freq;
  }

  if ('times_of_day' in body) {
    if (!Array.isArray(body.times_of_day) || body.times_of_day.length === 0) {
      return { ok: false, error: 'times_of_day must be a non-empty array of HH:MM strings' };
    }
    for (const t of body.times_of_day) {
      if (typeof t !== 'string' || !TIME_RE.test(t)) {
        return { ok: false, error: `Invalid time in times_of_day: ${String(t)} (expected HH:MM)` };
      }
    }
    // De-duplicated for the same reason as the create route: a repeated time
    // produces two expected doses sharing one key, which permanently caps
    // adherence below 100%.
    patch.times_of_day = [...new Set(body.times_of_day as string[])];
  }

  if ('food_instruction' in body) {
    const food = body.food_instruction as FoodInstruction;
    if (!FOODS.includes(food)) {
      return { ok: false, error: `food_instruction must be one of ${FOODS.join(', ')}` };
    }
    patch.food_instruction = food;
  }

  if ('start_date' in body) {
    if (typeof body.start_date !== 'string' || !DATE_RE.test(body.start_date)) {
      return { ok: false, error: 'start_date must be YYYY-MM-DD' };
    }
    patch.start_date = body.start_date;
  }

  if ('duration_days' in body) {
    if (body.duration_days === null) {
      patch.duration_days = null;
    } else {
      const n = Number(body.duration_days);
      if (!Number.isInteger(n) || n <= 0) {
        return { ok: false, error: 'duration_days must be null or a positive integer' };
      }
      patch.duration_days = n;
    }
  }

  // null is meaningful here, not "unset": it restores the derived-from-times
  // default, so it must be distinguishable from omitting the key entirely.
  if ('min_gap_minutes' in body) {
    if (body.min_gap_minutes === null) {
      patch.min_gap_minutes = null;
    } else {
      const n = Number(body.min_gap_minutes);
      if (!Number.isInteger(n) || n <= 0 || n > MAX_MIN_GAP_MINUTES) {
        return {
          ok: false,
          error: `min_gap_minutes must be null or a positive integer up to ${MAX_MIN_GAP_MINUTES}`,
        };
      }
      patch.min_gap_minutes = n;
    }
  }

  for (const key of ['form', 'dose_label', 'color'] as const) {
    if (key in body) {
      if (typeof body[key] !== 'string' || body[key].trim().length === 0) {
        return { ok: false, error: `${key} must be a non-empty string` };
      }
      patch[key] = (body[key] as string).trim();
    }
  }

  if ('strength' in body) patch.strength = optionalText(body.strength);
  if ('notes' in body) patch.notes = optionalText(body.notes);

  if ('active' in body) {
    if (typeof body.active !== 'boolean') return { ok: false, error: 'active must be a boolean' };
    patch.active = body.active;
  }

  if ('sort_order' in body) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n)) return { ok: false, error: 'sort_order must be an integer' };
    patch.sort_order = n;
  }

  return { ok: true, value: patch };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const parsed = parsePatch(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const medication = await updateMedication(id, session.userId, parsed.value);
    return NextResponse.json({ medication });
  } catch (e) {
    if (String(e).includes('Medicine not found')) {
      return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    }

    // Report honestly. Returning { ok: true } for a row that was never there
    // hides real failures behind a UI that says the medicine was removed.
    const existing = await sql`
      SELECT id FROM medications WHERE id = ${id} AND user_id = ${session.userId} LIMIT 1
    `;
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    }

    await deleteMedication(id, session.userId);
    return NextResponse.json({ ok: true, deleted: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
