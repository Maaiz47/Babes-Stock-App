import { NextRequest, NextResponse } from 'next/server';
import { getItemHistory } from '@/lib/db';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const history = await getItemHistory(id);
    return NextResponse.json({ history });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
