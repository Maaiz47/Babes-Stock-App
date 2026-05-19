import { NextRequest, NextResponse } from 'next/server';
import { moveItemLocation, transferStockBetweenLocations } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    const body = await req.json();
    const { location, qty } = body;

    if (qty !== undefined && qty !== null) {
      const result = await transferStockBetweenLocations(id, location, Number(qty), session?.username ?? undefined);
      return NextResponse.json(result);
    } else {
      const item = await moveItemLocation(id, location ?? null, session?.username ?? undefined);
      return NextResponse.json({ item });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
