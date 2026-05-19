import { sql } from '@vercel/postgres';
import type { StockItem, StockItemInput, StockFilters, BulkActionPayload } from './types';

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS stock_items (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      stock_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      rack_number TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      physical_quantity INTEGER,
      status TEXT NOT NULL DEFAULT 'in-stock',
      date_added DATE NOT NULL DEFAULT CURRENT_DATE,
      date_removed DATE,
      released_to TEXT,
      received_by TEXT,
      stored_by TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_stock_number ON stock_items(stock_number);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_status ON stock_items(status);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_date_added ON stock_items(date_added);
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS stock_history (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      stock_item_id UUID NOT NULL,
      stock_number TEXT NOT NULL,
      change_type TEXT NOT NULL,
      quantity_before INTEGER,
      quantity_after INTEGER,
      physical_before INTEGER,
      physical_after INTEGER,
      delta INTEGER,
      notes TEXT,
      changed_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_history_item ON stock_history(stock_item_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_history_created ON stock_history(created_at DESC)
  `;
}

function mapRow(row: Record<string, unknown>): StockItem {
  const qty = Number(row.quantity ?? 0);
  const physQty = row.physical_quantity != null ? Number(row.physical_quantity) : null;
  return {
    id: String(row.id),
    stock_number: String(row.stock_number),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    category: row.category ? String(row.category) : undefined,
    rack_number: row.rack_number ? String(row.rack_number) : undefined,
    quantity: qty,
    physical_quantity: physQty,
    quantity_mismatch: physQty !== null && physQty !== qty,
    status: String(row.status) as StockItem['status'],
    date_added: String(row.date_added).split('T')[0],
    date_removed: row.date_removed ? String(row.date_removed).split('T')[0] : null,
    released_to: row.released_to ? String(row.released_to) : null,
    received_by: row.received_by ? String(row.received_by) : null,
    stored_by: row.stored_by ? String(row.stored_by) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function getStockItems(filters: Partial<StockFilters> = {}): Promise<StockItem[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.search) {
    conditions.push(
      `(name ILIKE $${idx} OR stock_number ILIKE $${idx} OR description ILIKE $${idx} OR category ILIKE $${idx} OR rack_number ILIKE $${idx} OR released_to ILIKE $${idx} OR received_by ILIKE $${idx} OR stored_by ILIKE $${idx} OR status ILIKE $${idx} OR notes ILIKE $${idx})`
    );
    values.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.status && filters.status !== 'all') {
    conditions.push(`status = $${idx}`);
    values.push(filters.status);
    idx++;
  }
  if (filters.category && filters.category !== 'all') {
    conditions.push(`category ILIKE $${idx}`);
    values.push(`%${filters.category}%`);
    idx++;
  }
  if (filters.rack_number && filters.rack_number !== 'all') {
    conditions.push(`rack_number ILIKE $${idx}`);
    values.push(`%${filters.rack_number}%`);
    idx++;
  }
  if (filters.date_added_from) {
    conditions.push(`date_added >= $${idx}`);
    values.push(filters.date_added_from);
    idx++;
  }
  if (filters.date_added_to) {
    conditions.push(`date_added <= $${idx}`);
    values.push(filters.date_added_to);
    idx++;
  }
  if (filters.date_removed_from) {
    conditions.push(`date_removed >= $${idx}`);
    values.push(filters.date_removed_from);
    idx++;
  }
  if (filters.date_removed_to) {
    conditions.push(`date_removed <= $${idx}`);
    values.push(filters.date_removed_to);
    idx++;
  }
  if (filters.stored_by) {
    conditions.push(`stored_by ILIKE $${idx}`);
    values.push(`%${filters.stored_by}%`);
    idx++;
  }
  if (filters.released_to) {
    conditions.push(`released_to ILIKE $${idx}`);
    values.push(`%${filters.released_to}%`);
    idx++;
  }
  if (filters.received_by) {
    conditions.push(`received_by ILIKE $${idx}`);
    values.push(`%${filters.received_by}%`);
    idx++;
  }
  if (filters.mismatch_only) {
    conditions.push(`(physical_quantity IS NOT NULL AND physical_quantity != quantity)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM stock_items ${where} ORDER BY created_at DESC`;

  const result = await sql.query(query, values);
  return result.rows.map(mapRow);
}

export async function getStockItem(id: string): Promise<StockItem | null> {
  const result = await sql`SELECT * FROM stock_items WHERE id = ${id}`;
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function createStockItem(input: StockItemInput): Promise<StockItem> {
  const result = await sql`
    INSERT INTO stock_items (
      stock_number, name, description, category, rack_number,
      quantity, physical_quantity, status, date_added, date_removed,
      released_to, received_by, stored_by, notes
    ) VALUES (
      ${input.stock_number}, ${input.name}, ${input.description ?? null},
      ${input.category ?? null}, ${input.rack_number ?? null},
      ${input.quantity}, ${input.physical_quantity ?? null},
      ${input.status}, ${input.date_added}, ${input.date_removed ?? null},
      ${input.released_to ?? null}, ${input.received_by ?? null},
      ${input.stored_by ?? null}, ${input.notes ?? null}
    )
    RETURNING *
  `;
  return mapRow(result.rows[0]);
}

export async function updateStockItem(id: string, input: Partial<StockItemInput>): Promise<StockItem> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed: (keyof StockItemInput)[] = [
    'stock_number', 'name', 'description', 'category', 'rack_number',
    'quantity', 'physical_quantity', 'status', 'date_added', 'date_removed',
    'released_to', 'received_by', 'stored_by', 'notes'
  ];

  for (const key of allowed) {
    if (key in input) {
      fields.push(`${key} = $${idx}`);
      values.push(input[key] ?? null);
      idx++;
    }
  }

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const query = `UPDATE stock_items SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
  const result = await sql.query(query, values);
  return mapRow(result.rows[0]);
}

export async function deleteStockItem(id: string): Promise<void> {
  await sql`DELETE FROM stock_items WHERE id = ${id}`;
}

export async function bulkAction(payload: BulkActionPayload): Promise<{ affected: number }> {
  const placeholders = payload.ids.map((_, i) => `$${i + 1}`).join(', ');

  if (payload.action === 'delete') {
    const result = await sql.query(
      `DELETE FROM stock_items WHERE id IN (${placeholders})`,
      payload.ids
    );
    return { affected: result.rowCount ?? 0 };
  }

  if (payload.action === 'update_status' && payload.data?.status) {
    const values: unknown[] = [...payload.ids, payload.data.status];
    const result = await sql.query(
      `UPDATE stock_items SET status = $${payload.ids.length + 1}, updated_at = NOW() WHERE id IN (${placeholders})`,
      values
    );
    return { affected: result.rowCount ?? 0 };
  }

  if (payload.action === 'update_physical_qty' && payload.data?.physical_quantity !== undefined) {
    const values: unknown[] = [...payload.ids, payload.data.physical_quantity];
    const result = await sql.query(
      `UPDATE stock_items SET physical_quantity = $${payload.ids.length + 1}, updated_at = NOW() WHERE id IN (${placeholders})`,
      values
    );
    return { affected: result.rowCount ?? 0 };
  }

  return { affected: 0 };
}

export type ImportMode = 'general' | 'count' | 'release';

export async function bulkCreateStockItems(
  items: StockItemInput[],
  mode: ImportMode = 'general'
): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      if (mode === 'count') {
        // Stock count: for existing items only update physical_quantity (preserve system qty).
        // For new items, set physical_quantity = quantity as best guess.
        const physQty = item.physical_quantity ?? item.quantity;
        await sql`
          INSERT INTO stock_items (
            stock_number, name, description, category, rack_number,
            quantity, physical_quantity, status, date_added, stored_by, notes
          ) VALUES (
            ${item.stock_number}, ${item.name}, ${item.description ?? null},
            ${item.category ?? null}, ${item.rack_number ?? null},
            ${physQty}, ${physQty},
            ${item.status}, ${item.date_added}, ${item.stored_by ?? null}, ${item.notes ?? null}
          )
          ON CONFLICT (stock_number) DO UPDATE SET
            physical_quantity = ${physQty},
            updated_at = NOW()
        `;
      } else if (mode === 'release') {
        // Stock release: for existing items update system quantity, release fields, status.
        // Preserve physical_quantity.
        await sql`
          INSERT INTO stock_items (
            stock_number, name, description, category, rack_number,
            quantity, physical_quantity, status, date_added, date_removed,
            released_to, received_by, stored_by, notes
          ) VALUES (
            ${item.stock_number}, ${item.name}, ${item.description ?? null},
            ${item.category ?? null}, ${item.rack_number ?? null},
            ${item.quantity}, ${item.physical_quantity ?? null},
            'removed', ${item.date_added}, ${item.date_removed ?? null},
            ${item.released_to ?? null}, ${item.received_by ?? null},
            ${item.stored_by ?? null}, ${item.notes ?? null}
          )
          ON CONFLICT (stock_number) DO UPDATE SET
            quantity = EXCLUDED.quantity,
            status = 'removed',
            date_removed = EXCLUDED.date_removed,
            released_to = EXCLUDED.released_to,
            received_by = EXCLUDED.received_by,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        `;
      } else {
        // General: full upsert or plain insert
        await sql`
          INSERT INTO stock_items (
            stock_number, name, description, category, rack_number,
            quantity, physical_quantity, status, date_added, date_removed,
            released_to, received_by, stored_by, notes
          ) VALUES (
            ${item.stock_number}, ${item.name}, ${item.description ?? null},
            ${item.category ?? null}, ${item.rack_number ?? null},
            ${item.quantity}, ${item.physical_quantity ?? null},
            ${item.status}, ${item.date_added}, ${item.date_removed ?? null},
            ${item.released_to ?? null}, ${item.received_by ?? null},
            ${item.stored_by ?? null}, ${item.notes ?? null}
          )
          ON CONFLICT (stock_number) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            rack_number = EXCLUDED.rack_number,
            quantity = EXCLUDED.quantity,
            physical_quantity = EXCLUDED.physical_quantity,
            status = EXCLUDED.status,
            date_added = EXCLUDED.date_added,
            date_removed = EXCLUDED.date_removed,
            released_to = EXCLUDED.released_to,
            received_by = EXCLUDED.received_by,
            stored_by = EXCLUDED.stored_by,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        `;
      }
      created++;
    } catch (e) {
      errors.push(`${item.stock_number}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  return { created, errors };
}

export async function adjustQuantity(
  id: string,
  type: 'add' | 'subtract' | 'set_system' | 'count',
  amount: number,
  opts?: { notes?: string; changed_by?: string; taken_by?: string }
): Promise<StockItem> {
  const current = await getStockItem(id);
  if (!current) throw new Error('Item not found');

  let newQty = current.quantity;
  let newPhysical = current.physical_quantity ?? null;

  if (type === 'add') {
    newQty = current.quantity + amount;
    // Mirror the change on physical stock too
    newPhysical = (current.physical_quantity ?? current.quantity) + amount;
  } else if (type === 'subtract') {
    newQty = Math.max(0, current.quantity - amount);
    newPhysical = Math.max(0, (current.physical_quantity ?? current.quantity) - amount);
  } else if (type === 'set_system') {
    newQty = amount;
    // physical stays unchanged for manual system overrides
  } else if (type === 'count') {
    newPhysical = amount;
    // system qty stays unchanged — mismatch will be flagged
  }

  const takenBy = type === 'subtract' && opts?.taken_by ? opts.taken_by : null;

  const result = await sql`
    UPDATE stock_items SET
      quantity = ${newQty},
      physical_quantity = ${newPhysical},
      released_to = COALESCE(${takenBy}::text, released_to),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  await sql`
    INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, physical_before, physical_after, delta, notes, changed_by)
    VALUES (
      ${id}, ${current.stock_number}, ${type},
      ${current.quantity}, ${newQty},
      ${current.physical_quantity ?? null}, ${newPhysical},
      ${type === 'add' ? amount : type === 'subtract' ? -amount : type === 'set_system' ? newQty - current.quantity : null},
      ${opts?.notes ?? null}, ${opts?.taken_by ?? opts?.changed_by ?? null}
    )
  `;

  return mapRow(result.rows[0]);
}

export interface HistoryEntry {
  id: string;
  stock_item_id: string;
  stock_number: string;
  change_type: string;
  quantity_before: number | null;
  quantity_after: number | null;
  physical_before: number | null;
  physical_after: number | null;
  delta: number | null;
  notes: string | null;
  changed_by: string | null;
  created_at: string;
}

export async function getItemHistory(stockItemId: string): Promise<HistoryEntry[]> {
  const result = await sql`
    SELECT * FROM stock_history
    WHERE stock_item_id = ${stockItemId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return result.rows.map(r => ({
    id: String(r.id),
    stock_item_id: String(r.stock_item_id),
    stock_number: String(r.stock_number),
    change_type: String(r.change_type),
    quantity_before: r.quantity_before != null ? Number(r.quantity_before) : null,
    quantity_after: r.quantity_after != null ? Number(r.quantity_after) : null,
    physical_before: r.physical_before != null ? Number(r.physical_before) : null,
    physical_after: r.physical_after != null ? Number(r.physical_after) : null,
    delta: r.delta != null ? Number(r.delta) : null,
    notes: r.notes ? String(r.notes) : null,
    changed_by: r.changed_by ? String(r.changed_by) : null,
    created_at: String(r.created_at),
  }));
}

export async function bulkPhysicalCount(
  items: { id: string; physical_quantity: number }[]
): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];
  for (const { id, physical_quantity } of items) {
    try {
      const current = await getStockItem(id);
      if (!current) { errors.push(`${id}: not found`); continue; }
      await sql`
        UPDATE stock_items SET physical_quantity = ${physical_quantity}, updated_at = NOW() WHERE id = ${id}
      `;
      await sql`
        INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, physical_before, physical_after, notes)
        VALUES (${id}, ${current.stock_number}, 'count', ${current.quantity}, ${current.quantity}, ${current.physical_quantity ?? null}, ${physical_quantity}, 'Bulk count update')
      `;
      updated++;
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { updated, errors };
}

export async function getDistinctValues(field: 'category' | 'rack_number' | 'stored_by' | 'released_to' | 'received_by'): Promise<string[]> {
  const result = await sql.query(
    `SELECT DISTINCT ${field} FROM stock_items WHERE ${field} IS NOT NULL AND ${field} != '' ORDER BY ${field}`,
    []
  );
  return result.rows.map((r) => String(r[field]));
}
