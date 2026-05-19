import { NextRequest, NextResponse } from 'next/server';
import { createUser, usernameExists, emailExists } from '@/lib/users';
import { createSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const { username, email, password } = await req.json();
    if (!username || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    if (username.length < 3) return NextResponse.json({ error: 'Username must be at least 3 characters' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    if (await usernameExists(username)) return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
    if (await emailExists(email)) return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    const user = await createUser(username, email, password);
    await createSession({ userId: user.id, username: user.username, email: user.email, isAdmin: user.is_admin });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
