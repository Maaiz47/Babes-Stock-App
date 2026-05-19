import { NextRequest, NextResponse } from 'next/server';
import { getUserByIdentifier, createResetToken } from '@/lib/users';
import { sendPasswordResetEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    const user = await getUserByIdentifier(email.trim());
    // Always return success to avoid email enumeration
    if (user) {
      const token = await createResetToken(user.id);
      await sendPasswordResetEmail(user.email, user.username, token);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
