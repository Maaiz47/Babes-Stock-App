import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserById, emailExists, createEmailChangeRequest } from '@/lib/users';
import { sendEmailVerificationCode } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { newEmail } = await req.json();
    if (!newEmail || !newEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (newEmail.toLowerCase() === user.email.toLowerCase()) {
      return NextResponse.json({ error: 'That is already your current email' }, { status: 400 });
    }

    if (await emailExists(newEmail)) {
      return NextResponse.json({ error: 'Email already in use by another account' }, { status: 409 });
    }

    const code = await createEmailChangeRequest(session.userId, newEmail);
    await sendEmailVerificationCode(newEmail, user.username, code);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
