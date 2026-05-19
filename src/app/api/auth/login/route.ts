import { NextRequest, NextResponse } from 'next/server';
import { getUserByIdentifier, verifyPassword } from '@/lib/users';
import { createSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const { identifier, password } = await req.json();
    if (!identifier || !password) {
      return NextResponse.json({ error: 'Username/email and password are required' }, { status: 400 });
    }
    const user = await getUserByIdentifier(identifier.trim());
    if (!user || !(await verifyPassword(user, password))) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    await createSession({ userId: user.id, username: user.username, email: user.email, isAdmin: user.is_admin });
    return NextResponse.json({ ok: true, isAdmin: user.is_admin });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
