import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { updateSettings, type MedSettings } from '@/lib/meds';

export const dynamic = 'force-dynamic';

type Parsed = { ok: true; value: Partial<MedSettings> } | { ok: false; error: string };

function parseSettingsPatch(raw: unknown): Parsed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;

  // Quiet hours are gone on purpose: a medication reminder must always be
  // audible, so there is no longer any setting that can mute one by time of day.
  // The columns still exist in the table (initMedsSchema runs on every boot and
  // dropping them is riskier than leaving them unused), but nothing may write
  // them — an unknown-field rejection here is what keeps them dead.
  const allowed = new Set([
    'tz_offset_minutes', 'alarm_enabled', 'alarm_sound', 'alarm_volume',
    'repeat_interval_min', 'max_repeats', 'snooze_min',
  ]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return { ok: false, error: `Unknown field: ${key}` };
  }

  const patch: Partial<MedSettings> = {};

  if ('tz_offset_minutes' in body) {
    const n = Number(body.tz_offset_minutes);
    if (!Number.isInteger(n) || n < -720 || n > 840) {
      return { ok: false, error: 'tz_offset_minutes must be an integer between -720 and 840' };
    }
    patch.tz_offset_minutes = n;
  }

  if ('alarm_enabled' in body) {
    if (typeof body.alarm_enabled !== 'boolean') {
      return { ok: false, error: 'alarm_enabled must be a boolean' };
    }
    patch.alarm_enabled = body.alarm_enabled;
  }

  if ('alarm_sound' in body) {
    if (typeof body.alarm_sound !== 'string' || body.alarm_sound.trim().length === 0) {
      return { ok: false, error: 'alarm_sound must be a non-empty string' };
    }
    patch.alarm_sound = body.alarm_sound.trim();
  }

  if ('alarm_volume' in body) {
    const n = Number(body.alarm_volume);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { ok: false, error: 'alarm_volume must be a number between 0 and 1' };
    }
    patch.alarm_volume = n;
  }

  // Integer guards below keep the nagging loop inside sane bounds — a zero
  // repeat interval would hammer her phone every cron tick.
  if ('repeat_interval_min' in body) {
    const n = Number(body.repeat_interval_min);
    if (!Number.isInteger(n) || n < 1 || n > 240) {
      return { ok: false, error: 'repeat_interval_min must be an integer between 1 and 240' };
    }
    patch.repeat_interval_min = n;
  }

  if ('max_repeats' in body) {
    const n = Number(body.max_repeats);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: 'max_repeats must be an integer between 0 and 100' };
    }
    patch.max_repeats = n;
  }

  if ('snooze_min' in body) {
    const n = Number(body.snooze_min);
    if (!Number.isInteger(n) || n < 1 || n > 240) {
      return { ok: false, error: 'snooze_min must be an integer between 1 and 240' };
    }
    patch.snooze_min = n;
  }

  return { ok: true, value: patch };
}

export async function PATCH(req: NextRequest) {
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

    const parsed = parseSettingsPatch(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const settings = await updateSettings(session.userId, parsed.value);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
