import { NextRequest, NextResponse } from 'next/server';
import { moveItemLocation } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    const { location } = await req.json();
    const item = await moveItemLocation(id, location ?? null, session?.username ?? undefined);
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
