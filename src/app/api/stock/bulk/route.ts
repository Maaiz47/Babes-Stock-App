import { NextRequest, NextResponse } from 'next/server';
import { bulkAction, bulkCreateStockItems, bulkPhysicalCount } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'import') {
      const result = await bulkCreateStockItems(body.items, body.mode ?? 'general');
      return NextResponse.json(result);
    }

    if (body.action === 'bulk_count') {
      const result = await bulkPhysicalCount(body.items);
      return NextResponse.json(result);
    }

    const result = await bulkAction(body);
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
