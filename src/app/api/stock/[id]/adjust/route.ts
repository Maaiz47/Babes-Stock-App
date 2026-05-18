import { NextRequest, NextResponse } from 'next/server';
import { adjustQuantity } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const item = await adjustQuantity(id, body.type, body.amount, { notes: body.notes, changed_by: body.changed_by, taken_by: body.taken_by });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
