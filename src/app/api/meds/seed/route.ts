import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { initMedsSchema, seedPrescriptionDefaults } from '@/lib/meds';

export const dynamic = 'force-dynamic';

/**
 * Load the prescription defaults.
 * `replace: true` wipes the existing list first; otherwise this is a no-op when
 * she already has medicines saved.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Empty bodies are normal here — the UI posts this with no payload.
    let replace = false;
    try {
      const body = await req.json();
      if (body && typeof body === 'object') replace = (body as { replace?: unknown }).replace === true;
    } catch {
      /* no body */
    }

    // This is the bootstrap route, so make sure the tables exist before writing.
    await initMedsSchema();
    const medications = await seedPrescriptionDefaults(session.userId, replace);

    return NextResponse.json({ medications });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
