import { NextRequest, NextResponse } from 'next/server';
import { getStockItems, createStockItem, getDistinctValues, getTotalCount } from '@/lib/db';
import type { StockFilters } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const filters: Partial<StockFilters> = {
      search: p.get('search') || '',
      status: p.get('status') || '',
      category: p.get('category') || '',
      rack_number: p.get('rack_number') || '',
      date_added_from: p.get('date_added_from') || '',
      date_added_to: p.get('date_added_to') || '',
      date_removed_from: p.get('date_removed_from') || '',
      date_removed_to: p.get('date_removed_to') || '',
      stored_by: p.get('stored_by') || '',
      released_to: p.get('released_to') || '',
      received_by: p.get('received_by') || '',
      mismatch_only: p.get('mismatch_only') === 'true',
    };

    if (p.get('count') === 'true') {
      const count = await getTotalCount();
      return NextResponse.json({ count });
    }

    if (p.get('distinct')) {
      const field = p.get('distinct') as 'category' | 'location' | 'rack_number' | 'stored_by' | 'released_to' | 'received_by';
      const values = await getDistinctValues(field);
      return NextResponse.json({ values });
    }

    const items = await getStockItems(filters);
    return NextResponse.json({ items });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await createStockItem(body);
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
