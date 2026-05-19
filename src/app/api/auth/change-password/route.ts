import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserById, verifyPassword, updateUserPassword } from '@/lib/users';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const user = await getUserById(session.userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (!(await verifyPassword(user, currentPassword))) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    await updateUserPassword(session.userId, newPassword);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
