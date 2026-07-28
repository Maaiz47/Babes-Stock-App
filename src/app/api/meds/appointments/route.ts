import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getSession } from '@/lib/session';
import { canAccessMeds } from '@/lib/meds-access';
import { getAppointments, type Appointment } from '@/lib/meds';

export const dynamic = 'force-dynamic';

/**
 * Follow-up appointments (clinic reviews, lab results).
 *
 * These replace the old FOLLOW_UPS constant. That constant lived in a module
 * imported by the /meds client component, so the hospital, the clinician's
 * name, the department and the specimen type were all shipped inside a public,
 * unauthenticated JS chunk. Appointments now live in `med_appointments` and are
 * only ever served through this route, behind the same 403 gate and the same
 * session scoping as every other meds endpoint.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_KEYS = new Set(['label', 'date', 'detail']);

const MAX_LABEL = 500;
const MAX_DETAIL = 2000;

/** '2026-02-31' passes the regex but is not a day — catch it here, not as a 500. */
function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * A DATE column comes back as 'YYYY-MM-DD' from the Neon driver, but tolerate a
 * Date object too. Reading the local parts (which is how a Date built from a
 * DATE is constructed) avoids a UTC shift landing the appointment a day early.
 */
function toDateString(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(raw ?? '').slice(0, 10);
}

function mapAppointment(row: Record<string, unknown>): Appointment {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    label: String(row.label),
    date: toDateString(row.date),
    detail: row.detail ? String(row.detail) : null,
    created_at: String(row.created_at),
  };
}

/** Her appointments, newest commitment first is the lib's call — order is untouched here. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const appointments = await getAppointments(session.userId);
    return NextResponse.json({ appointments });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

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

    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ error: `Unknown field: ${key}` }, { status: 400 });
      }
    }

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 });
    }
    if (label.length > MAX_LABEL) {
      return NextResponse.json({ error: `label must be ${MAX_LABEL} characters or fewer` }, { status: 400 });
    }

    if (typeof body.date !== 'string' || !DATE_RE.test(body.date) || !isRealDate(body.date)) {
      return NextResponse.json({ error: 'date must be a real calendar date (YYYY-MM-DD)' }, { status: 400 });
    }
    const date = body.date;

    let detail: string | null = null;
    if (body.detail !== undefined && body.detail !== null) {
      if (typeof body.detail !== 'string') {
        return NextResponse.json({ error: 'detail must be a string' }, { status: 400 });
      }
      const trimmed = body.detail.trim();
      if (trimmed.length > MAX_DETAIL) {
        return NextResponse.json({ error: `detail must be ${MAX_DETAIL} characters or fewer` }, { status: 400 });
      }
      detail = trimmed.length > 0 ? trimmed : null;
    }

    // Written here rather than through a lib helper: the cross-agent contract
    // fixes the `med_appointments` columns and `getAppointments`, but not a
    // create/delete signature. Both statements are scoped to session.userId.
    const result = await sql`
      INSERT INTO med_appointments (user_id, label, date, detail)
      VALUES (${session.userId}, ${label}, ${date}, ${detail})
      RETURNING *
    `;

    return NextResponse.json({ appointment: mapAppointment(result.rows[0]) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || !canAccessMeds(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    // A non-UUID would raise Postgres 22P02 and surface as a 500 carrying the
    // raw driver text; it simply names no appointment of hers.
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const result = await sql`
      DELETE FROM med_appointments
      WHERE id = ${id} AND user_id = ${session.userId}
      RETURNING id
    `;
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
