import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { getSettings, getDayView, getAdherence, getAppointments, tzNow } from '@/lib/meds';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The whole day view: doses, medicines, settings, 7-day adherence and appointments. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The date must be resolved in *her* timezone, not the server's — a Vercel
    // box in UTC is already on tomorrow while it is still evening in Male'.
    const settings = await getSettings(session.userId);
    const requested = req.nextUrl.searchParams.get('date');
    const date = requested && DATE_RE.test(requested)
      ? requested
      : tzNow(settings.tz_offset_minutes).date;

    // Appointments carry clinical detail (clinician, department, specimen), so
    // they live in the DB behind this 403 gate rather than in a constant that
    // would be bundled into the public /meds client chunk.
    const [view, adherence, appointments] = await Promise.all([
      getDayView(session.userId, date),
      getAdherence(session.userId, 7),
      getAppointments(session.userId),
    ]);

    return NextResponse.json({ ...view, adherence, appointments });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
