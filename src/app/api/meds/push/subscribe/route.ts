import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { savePushSubscription } from '@/lib/meds';

export const dynamic = 'force-dynamic';

/** Register a device for reminders. Re-subscribing with the same endpoint updates it. */
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
    const body = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
    }

    const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
    if (!p256dh || !auth) {
      return NextResponse.json({ error: 'keys.p256dh and keys.auth are required' }, { status: 400 });
    }

    await savePushSubscription(
      session.userId,
      endpoint,
      p256dh,
      auth,
      req.headers.get('user-agent') ?? undefined
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
