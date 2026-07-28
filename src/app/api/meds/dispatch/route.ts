import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import {
  getDueDosesForDispatch,
  markNotified,
  FOOD_LABELS,
  type DueDose,
  type FoodInstruction,
} from '@/lib/meds';
import { sendPushToUser, type MedPushPayload } from '@/lib/push';

export const dynamic = 'force-dynamic';
// web-push needs Node crypto — this route must never be moved to the Edge runtime.
export const runtime = 'nodejs';

/** A dose this late gets its title shouted at her. */
const OVERDUE_THRESHOLD_MIN = 15;

/** Compare without leaking the secret's contents through response timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, so that check has to come first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** GitHub Actions sends a Bearer header; a browser check can use ?secret=. */
function extractSecret(req: NextRequest): string {
  const header = req.headers.get('authorization') ?? '';
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return req.nextUrl.searchParams.get('secret') ?? '';
}

function foodHint(food: FoodInstruction): string {
  if (food === 'any') return '';
  return ` (${FOOD_LABELS[food].toLowerCase()})`;
}

/**
 * True only when every dose in the batch is inside her quiet hours. The service
 * worker uses this to drop the vibration so a 3am reminder does not jolt her
 * awake — the notification itself is still delivered.
 */
function isSilentBatch(doses: DueDose[]): boolean {
  return doses.length > 0 && doses.every(d => d.silent);
}

/** One notification per user, never one per pill. */
function buildNotification(doses: DueDose[]): { title: string; body: string } {
  const overdue = doses.some(d => d.overdue_minutes >= OVERDUE_THRESHOLD_MIN);
  const prefix = overdue ? 'OVERDUE — ' : '';

  if (doses.length === 1) {
    const d = doses[0];
    return {
      title: `${prefix}Time for your medicine`,
      body: `${d.name}${d.strength ? ` ${d.strength}` : ''} — ${d.dose_label}${foodHint(d.food_instruction)}`,
    };
  }

  return {
    title: `${prefix}${doses.length} medicines due`,
    body: doses.map(d => d.name).join(', '),
  };
}

async function dispatch(req: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    if (!secretMatches(extractSecret(req), expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dueByUser = await getDueDosesForDispatch();

    let sent = 0;
    let users = 0;
    let skipped = 0;

    for (const [userId, doses] of dueByUser) {
      // One user's push service falling over must not stop everyone else's reminders.
      try {
        const { title, body } = buildNotification(doses);

        // The payload is typed as MedPushPayload plus the optional quiet-hours
        // flag, so `silent` survives the JSON.stringify in sendPushToUser
        // without widening the shared payload interface.
        const payload: MedPushPayload & { silent?: boolean } = {
          title,
          body,
          // A stable tag lets each repeat replace the last one instead of
          // stacking up a wall of notifications on the lock screen.
          tag: 'med-reminder',
          medicationId: doses.length === 1 ? doses[0].medication_id : null,
          scheduledAt: doses[0].scheduled_at,
          doseCount: doses.length,
          url: '/meds',
        };

        // Only a batch where *every* dose falls inside her quiet hours is sent
        // silently. If even one dose is outside them the notification stays
        // loud — a mixed batch is not a quiet-hours batch.
        if (isSilentBatch(doses)) payload.silent = true;

        const delivered = await sendPushToUser(userId, payload);

        if (delivered > 0) {
          sent += delivered;
          users++;
          // Only count the nag once it actually landed; a failed send leaves the
          // dose untouched so the next tick tries again.
          for (const dose of doses) {
            await markNotified(userId, dose.medication_id, dose.scheduled_at);
          }
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }

    return NextResponse.json({ sent, users, skipped });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return dispatch(req);
}

export async function POST(req: NextRequest) {
  return dispatch(req);
}
