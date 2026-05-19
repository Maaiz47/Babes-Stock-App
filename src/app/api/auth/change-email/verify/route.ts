import { NextRequest, NextResponse } from 'next/server';
import { getSession, createSession } from '@/lib/session';
import { getUserById, validateEmailChangeCode, markEmailChangeUsed, updateUserEmail } from '@/lib/users';
import { sendEmailChangeNotification } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { code } = await req.json();
    if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 });

    const newEmail = await validateEmailChangeCode(session.userId, code.trim());
    if (!newEmail) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 });

    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const oldEmail = user.email;

    await updateUserEmail(session.userId, newEmail);
    await markEmailChangeUsed(session.userId);

    // Refresh session with new email
    await createSession({ userId: session.userId, username: session.username, email: newEmail, isAdmin: session.isAdmin });

    // Notify old email
    await sendEmailChangeNotification(oldEmail, user.username, newEmail).catch(() => {});

    return NextResponse.json({ ok: true, newEmail });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
