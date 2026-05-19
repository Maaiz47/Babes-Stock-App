import { NextRequest, NextResponse } from 'next/server';
import { validateResetToken, markResetTokenUsed, updateUserPassword } from '@/lib/users';

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();
    if (!token || !password) return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    const userId = await validateResetToken(token);
    if (!userId) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
    await updateUserPassword(userId, password);
    await markResetTokenUsed(token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
