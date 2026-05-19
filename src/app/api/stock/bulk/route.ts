import { NextRequest, NextResponse } from 'next/server';
import { bulkAction, bulkCreateStockItems, bulkPhysicalCount } from '@/lib/db';
import { getSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const changedBy = session?.username ?? undefined;
    const body = await req.json();

    if (body.action === 'import') {
      const result = await bulkCreateStockItems(body.items, body.mode ?? 'general', changedBy);
      return NextResponse.json(result);
    }

    if (body.action === 'bulk_count') {
      const result = await bulkPhysicalCount(body.items, changedBy);
      return NextResponse.json(result);
    }

    const result = await bulkAction(body, changedBy);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
