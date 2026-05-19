import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, createUser, usernameExists, emailExists } from '@/lib/users';
import { getSession } from '@/lib/session';

async function requireAdmin() {
  const session = await getSession();
  if (!session?.isAdmin) throw new Error('Forbidden');
}

export async function GET() {
  try {
    await requireAdmin();
    const users = await getAllUsers();
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { username, email, password, isAdmin } = await req.json();
    if (!username || !email || !password) return NextResponse.json({ error: 'All fields required' }, { status: 400 });
    if (await usernameExists(username)) return NextResponse.json({ error: 'Username taken' }, { status: 409 });
    if (await emailExists(email)) return NextResponse.json({ error: 'Email taken' }, { status: 409 });
    const user = await createUser(username, email, password, isAdmin ?? false);
    const { password_hash: _, ...safe } = user;
    return NextResponse.json({ user: safe }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
