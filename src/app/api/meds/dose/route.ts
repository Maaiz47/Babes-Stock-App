import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { logDose, getMedications, type DoseStatus } from '@/lib/meds';

export const dynamic = 'force-dynamic';

const STATUSES: DoseStatus[] = ['taken', 'skipped', 'pending'];

/**
 * Reads the row a write is about to overwrite. Scoped to the session user so a
 * caller can never probe another account's history. Returns null when the dose
 * has never been actioned.
 *
 * This is deliberately a read of `medication_doses` rather than a day view:
 * the guard below has to see the *exact* stored status for this one instant.
 */
async function currentStatus(
  userId: string,
  medicationId: string,
  scheduledAt: string
): Promise<DoseStatus | null> {
  const result = await sql`
    SELECT status FROM medication_doses
    WHERE user_id = ${userId}
      AND medication_id = ${medicationId}
      AND scheduled_at = ${scheduledAt}
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return String(result.rows[0].status) as DoseStatus;
}

/** Tick a dose off, skip it, or snooze it (status 'pending' + snooze_minutes). */
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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;

    const medicationId = typeof body.medication_id === 'string' ? body.medication_id.trim() : '';
    if (!medicationId) {
      return NextResponse.json({ error: 'medication_id is required' }, { status: 400 });
    }

    if (typeof body.scheduled_at !== 'string' || Number.isNaN(new Date(body.scheduled_at).getTime())) {
      return NextResponse.json({ error: 'scheduled_at must be a valid date' }, { status: 400 });
    }
    const scheduledAt = new Date(body.scheduled_at).toISOString();

    const status = body.status as DoseStatus;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 });
    }

    let snoozeMinutes: number | undefined;
    if (body.snooze_minutes !== undefined && body.snooze_minutes !== null) {
      const n = Number(body.snooze_minutes);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'snooze_minutes must be a positive number' }, { status: 400 });
      }
      snoozeMinutes = n;
    }

    // `force` is how an explicit in-app action says "yes, I really mean to undo
    // a dose I already ticked off". The service worker's notification buttons
    // must never send it: a notification can sit on the lock screen for hours
    // after the dose was taken in the app.
    let force = false;
    if (body.force !== undefined && body.force !== null) {
      if (typeof body.force !== 'boolean') {
        return NextResponse.json({ error: 'force must be a boolean' }, { status: 400 });
      }
      force = body.force;
    }

    // Confirm the medicine is hers before writing — this also turns a bogus id
    // into a clean 404 instead of a foreign-key 500, and keeps the non-UUID id
    // out of the status read below.
    const medications = await getMedications(session.userId);
    if (!medications.some(m => m.id === medicationId)) {
      return NextResponse.json({ error: 'Medicine not found' }, { status: 404 });
    }

    // A stale notification must not be able to erase a taken record. Without
    // this, tapping Snooze at 09:00 on the still-open 08:00 alert would flip a
    // dose she already took back to pending, blank taken_at, and re-alarm her
    // for a dose that is already in her — a double-dose risk.
    if (!force && (status === 'pending' || status === 'skipped')) {
      const existing = await currentStatus(session.userId, medicationId, scheduledAt);
      if (existing === 'taken') {
        return NextResponse.json(
          { error: 'Dose already recorded as taken', status: 'taken' },
          { status: 409 }
        );
      }
    }

    await logDose(session.userId, medicationId, scheduledAt, status, snoozeMinutes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
