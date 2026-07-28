import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { sendPushToUser, pushConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Fire a single reminder at the caller's own devices so she can confirm the
 * sound and vibration actually go off on the phone before relying on it.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Without VAPID keys nothing can ever be delivered — say so rather than
    // reporting a cheerful "ok" that quietly sent nothing.
    if (!pushConfigured()) {
      return NextResponse.json({ error: 'Push is not configured on the server' }, { status: 503 });
    }

    const sent = await sendPushToUser(session.userId, {
      title: 'Test reminder',
      body: 'If you can hear this, your medicine alarms are working.',
      tag: 'med-test',
      medicationId: null,
      scheduledAt: new Date().toISOString(),
      doseCount: 0,
      url: '/meds',
    });

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
