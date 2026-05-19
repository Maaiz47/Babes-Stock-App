import { NextRequest, NextResponse } from 'next/server';
import { deleteUser, updateUserPassword, getUserById } from '@/lib/users';
import { getSession } from '@/lib/session';

async function requireAdmin() {
  const session = await getSession();
  if (!session?.isAdmin) throw new Error('Forbidden');
  return session;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    if (id === session.userId) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    const user = await getUserById(id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const { password } = await req.json();
    if (!password || password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    await updateUserPassword(id, password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
