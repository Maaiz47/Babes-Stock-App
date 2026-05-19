import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { userId: session.userId, username: session.username, email: session.email, isAdmin: session.isAdmin } });
}
