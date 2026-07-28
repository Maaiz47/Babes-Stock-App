import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { deletePushSubscription } from '@/lib/meds';

export const dynamic = 'force-dynamic';

/** Forget a device so it stops receiving reminders. */
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

    const endpoint = typeof (raw as { endpoint?: unknown }).endpoint === 'string'
      ? (raw as { endpoint: string }).endpoint.trim()
      : '';
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
    }

    // Scoped to the session user. The endpoint is caller-supplied, and
    // canAccessMeds is true for every admin, so an unscoped delete would let
    // any admin unregister anyone's phone and silently kill her reminders.
    await deletePushSubscription(endpoint, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
