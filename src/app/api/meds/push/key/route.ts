import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';

export const dynamic = 'force-dynamic';

/** The VAPID public key the browser needs to build a push subscription. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
