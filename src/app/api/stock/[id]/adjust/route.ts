import { NextRequest, NextResponse } from 'next/server';
import { adjustQuantity } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    const body = await req.json();
    const item = await adjustQuantity(id, body.type, body.amount, {
      notes: body.notes,
      changed_by: session?.username ?? undefined,
      taken_by: body.taken_by,
      brought_by: body.brought_by,
    });
    return NextResponse.json({ item });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
