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
  // Migration: add location column if it doesn't exist yet
  await sql`ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS location TEXT`;
  // Allow same stock number in different locations
  await sql`ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_stock_number_key`;

  // Auth tables
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS email_change_requests (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      new_email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Seed admin user if none exists (password: 123456, hashed)
  // bcrypt hash of '123456' with 10 rounds
  const adminCheck = await sql`SELECT id FROM users WHERE is_admin = true LIMIT 1`;
  if (adminCheck.rows.length === 0) {
    const { hash } = await import('bcryptjs');
    const hash123456 = await hash('123456', 10);
    await sql`
      INSERT INTO users (username, email, password_hash, is_admin)
      VALUES ('admin', 'admin@babesstock.com', ${hash123456}, true)
      ON CONFLICT DO NOTHING
    `;
  }
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
    location: row.location ? String(row.location) : null,
    rack_number: row.rack_number ? String(row.rack_number) : undefined,
    quantity: qty,
    physical_quantity: physQty,
    quantity_mismatch: physQty !== null && physQty !== qty,
    mismatch_type: physQty === null ? null : physQty < qty ? 'missing' : physQty > qty ? 'excess' : null,
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
  if (filters.location && filters.location !== 'all') {
    conditions.push(`location ILIKE $${idx}`);
    values.push(`%${filters.location}%`);
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
  if (filters.mismatch_type === 'missing') {
    conditions.push(`(physical_quantity IS NOT NULL AND physical_quantity < quantity)`);
  } else if (filters.mismatch_type === 'excess') {
    conditions.push(`(physical_quantity IS NOT NULL AND physical_quantity > quantity)`);
  } else if (filters.mismatch_only) {
    conditions.push(`(physical_quantity IS NOT NULL AND physical_quantity != quantity)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM stock_items ${where} ORDER BY created_at DESC`;

  const result = await sql.query(query, values);
  return result.rows.map(mapRow);
}

export async function getTotalCount(): Promise<number> {
  const result = await sql`SELECT COUNT(*)::int AS count FROM stock_items`;
  return result.rows[0].count as number;
}

export async function getStats(): Promise<{ total: number; in_stock: number; low_stock: number; mismatches: number; missing: number; excess: number }> {
  const result = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'in-stock')::int AS in_stock,
      COUNT(*) FILTER (WHERE status = 'low-stock')::int AS low_stock,
      COUNT(*) FILTER (WHERE physical_quantity IS NOT NULL AND physical_quantity != quantity)::int AS mismatches,
      COUNT(*) FILTER (WHERE physical_quantity IS NOT NULL AND physical_quantity < quantity)::int AS missing,
      COUNT(*) FILTER (WHERE physical_quantity IS NOT NULL AND physical_quantity > quantity)::int AS excess
    FROM stock_items
  `;
  return result.rows[0] as { total: number; in_stock: number; low_stock: number; mismatches: number; missing: number; excess: number };
}

export async function getStockItem(id: string): Promise<StockItem | null> {
  const result = await sql`SELECT * FROM stock_items WHERE id = ${id}`;
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function createStockItem(input: StockItemInput, changedBy?: string): Promise<StockItem> {
  const result = await sql`
    INSERT INTO stock_items (
      stock_number, name, description, category, location, rack_number,
      quantity, physical_quantity, status, date_added, date_removed,
      released_to, received_by, stored_by, notes
    ) VALUES (
      ${input.stock_number}, ${input.name}, ${input.description ?? null},
      ${input.category ?? null}, ${input.location ?? null}, ${input.rack_number ?? null},
      ${input.quantity}, ${input.physical_quantity ?? null},
      ${input.status}, ${input.date_added}, ${input.date_removed ?? null},
      ${input.released_to ?? null}, ${input.received_by ?? null},
      ${input.stored_by ?? null}, ${input.notes ?? null}
    )
    RETURNING *
  `;
  const item = mapRow(result.rows[0]);
  await sql`
    INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, physical_before, physical_after, delta, notes, changed_by)
    VALUES (${item.id}, ${item.stock_number}, 'create', 0, ${item.quantity}, null, ${item.physical_quantity ?? null}, ${item.quantity}, null, ${changedBy ?? null})
  `;
  return item;
}

export async function updateStockItem(id: string, input: Partial<StockItemInput>, changedBy?: string): Promise<StockItem> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed: (keyof StockItemInput)[] = [
    'stock_number', 'name', 'description', 'category', 'location', 'rack_number',
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
  const item = mapRow(result.rows[0]);
  await sql`
    INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, notes, changed_by)
    VALUES (${id}, ${item.stock_number}, 'edit', ${'quantity' in input ? null : item.quantity}, ${item.quantity}, 'Item details edited', ${changedBy ?? null})
  `;
  return item;
}

export async function deleteStockItem(id: string, changedBy?: string): Promise<void> {
  const item = await getStockItem(id);
  if (item) {
    await sql`
      INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, delta, notes, changed_by)
      VALUES (${id}, ${item.stock_number}, 'delete', ${item.quantity}, 0, ${-item.quantity}, 'Item deleted', ${changedBy ?? null})
    `;
  }
  await sql`DELETE FROM stock_items WHERE id = ${id}`;
}

export async function bulkAction(payload: BulkActionPayload, changedBy?: string): Promise<{ affected: number }> {
  const placeholders = payload.ids.map((_, i) => `$${i + 1}`).join(', ');

  if (payload.action === 'delete') {
    const items = await sql.query(`SELECT id, stock_number, quantity FROM stock_items WHERE id IN (${placeholders})`, payload.ids);
    for (const row of items.rows) {
      await sql`
        INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, delta, notes, changed_by)
        VALUES (${String(row.id)}, ${String(row.stock_number)}, 'delete', ${Number(row.quantity)}, 0, ${-Number(row.quantity)}, 'Bulk deleted', ${changedBy ?? null})
      `;
    }
    const result = await sql.query(`DELETE FROM stock_items WHERE id IN (${placeholders})`, payload.ids);
    return { affected: result.rowCount ?? 0 };
  }

  if (payload.action === 'update_status' && payload.data?.status) {
    const items = await sql.query(`SELECT id, stock_number, quantity FROM stock_items WHERE id IN (${placeholders})`, payload.ids);
    const values: unknown[] = [...payload.ids, payload.data.status];
    const result = await sql.query(
      `UPDATE stock_items SET status = $${payload.ids.length + 1}, updated_at = NOW() WHERE id IN (${placeholders})`,
      values
    );
    for (const row of items.rows) {
      await sql`
        INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, notes, changed_by)
        VALUES (${String(row.id)}, ${String(row.stock_number)}, 'edit', ${Number(row.quantity)}, ${Number(row.quantity)}, ${`Status → ${payload.data.status}`}, ${changedBy ?? null})
      `;
    }
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
  mode: ImportMode = 'general',
  changedBy?: string
): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      if (mode === 'count') {
        const physQty = item.physical_quantity ?? null;
        const sysQty = item.quantity; // preserve system qty as-is
        // Try to update existing item (match on stock_number + location)
        const existing = await sql.query(
          `SELECT id, stock_number, quantity, physical_quantity FROM stock_items WHERE stock_number = $1 AND COALESCE(location, '') = COALESCE($2, '') LIMIT 1`,
          [item.stock_number, item.location ?? null]
        );
        let rowId: string, rowStockNumber: string, rowQty: number;
        if (existing.rows.length > 0) {
          const r = existing.rows[0];
          await sql.query(
            `UPDATE stock_items SET physical_quantity = $1, updated_at = NOW() WHERE id = $2`,
            [physQty, r.id]
          );
          rowId = String(r.id);
          rowStockNumber = String(r.stock_number);
          rowQty = Number(r.quantity);
        } else {
          const ins = await sql`
            INSERT INTO stock_items (
              stock_number, name, description, category, location, rack_number,
              quantity, physical_quantity, status, date_added, stored_by, notes
            ) VALUES (
              ${item.stock_number}, ${item.name}, ${item.description ?? null},
              ${item.category ?? null}, ${item.location ?? null}, ${item.rack_number ?? null},
              ${sysQty}, ${physQty},
              ${item.status}, ${item.date_added}, ${item.stored_by ?? null}, ${item.notes ?? null}
            )
            RETURNING id, stock_number, quantity
          `;
          rowId = String(ins.rows[0].id);
          rowStockNumber = String(ins.rows[0].stock_number);
          rowQty = Number(ins.rows[0].quantity);
        }
        await sql`
          INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, physical_before, physical_after, notes, changed_by)
          VALUES (${rowId}, ${rowStockNumber}, 'count', ${rowQty}, ${rowQty}, null, ${physQty}, 'Imported count', ${changedBy ?? null})
        `;
      } else if (mode === 'release') {
        const existing = await sql.query(
          `SELECT id, stock_number, quantity FROM stock_items WHERE stock_number = $1 AND COALESCE(location, '') = COALESCE($2, '') LIMIT 1`,
          [item.stock_number, item.location ?? null]
        );
        let rowId: string, rowStockNumber: string, rowQty: number;
        if (existing.rows.length > 0) {
          const r = existing.rows[0];
          await sql.query(
            `UPDATE stock_items SET quantity = $1, status = 'removed', date_removed = $2, released_to = $3, received_by = $4, notes = $5, updated_at = NOW() WHERE id = $6`,
            [item.quantity, item.date_removed ?? null, item.released_to ?? null, item.received_by ?? null, item.notes ?? null, r.id]
          );
          rowId = String(r.id);
          rowStockNumber = String(r.stock_number);
          rowQty = Number(r.quantity);
        } else {
          const ins = await sql`
            INSERT INTO stock_items (
              stock_number, name, description, category, location, rack_number,
              quantity, physical_quantity, status, date_added, date_removed,
              released_to, received_by, stored_by, notes
            ) VALUES (
              ${item.stock_number}, ${item.name}, ${item.description ?? null},
              ${item.category ?? null}, ${item.location ?? null}, ${item.rack_number ?? null},
              ${item.quantity}, ${item.physical_quantity ?? null},
              'removed', ${item.date_added}, ${item.date_removed ?? null},
              ${item.released_to ?? null}, ${item.received_by ?? null},
              ${item.stored_by ?? null}, ${item.notes ?? null}
            )
            RETURNING id, stock_number, quantity
          `;
          rowId = String(ins.rows[0].id);
          rowStockNumber = String(ins.rows[0].stock_number);
          rowQty = Number(ins.rows[0].quantity);
        }
        await sql`
          INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, notes, changed_by)
          VALUES (${rowId}, ${rowStockNumber}, 'subtract', null, ${rowQty}, 'Imported release', ${changedBy ?? null})
        `;
      } else {
        const existing = await sql.query(
          `SELECT id, stock_number, quantity FROM stock_items WHERE stock_number = $1 AND COALESCE(location, '') = COALESCE($2, '') LIMIT 1`,
          [item.stock_number, item.location ?? null]
        );
        let rowId: string, rowStockNumber: string, rowQty: number;
        if (existing.rows.length > 0) {
          const r = existing.rows[0];
          await sql.query(
            `UPDATE stock_items SET name = $1, description = $2, category = $3, location = $4, rack_number = $5, quantity = $6, physical_quantity = $7, status = $8, date_added = $9, date_removed = $10, released_to = $11, received_by = $12, stored_by = $13, notes = $14, updated_at = NOW() WHERE id = $15`,
            [item.name, item.description ?? null, item.category ?? null, item.location ?? null, item.rack_number ?? null, item.quantity, item.physical_quantity ?? null, item.status, item.date_added, item.date_removed ?? null, item.released_to ?? null, item.received_by ?? null, item.stored_by ?? null, item.notes ?? null, r.id]
          );
          rowId = String(r.id);
          rowStockNumber = String(r.stock_number);
          rowQty = item.quantity;
        } else {
          const ins = await sql`
            INSERT INTO stock_items (
              stock_number, name, description, category, location, rack_number,
              quantity, physical_quantity, status, date_added, date_removed,
              released_to, received_by, stored_by, notes
            ) VALUES (
              ${item.stock_number}, ${item.name}, ${item.description ?? null},
              ${item.category ?? null}, ${item.location ?? null}, ${item.rack_number ?? null},
              ${item.quantity}, ${item.physical_quantity ?? null},
              ${item.status}, ${item.date_added}, ${item.date_removed ?? null},
              ${item.released_to ?? null}, ${item.received_by ?? null},
              ${item.stored_by ?? null}, ${item.notes ?? null}
            )
            RETURNING id, stock_number, quantity
          `;
          rowId = String(ins.rows[0].id);
          rowStockNumber = String(ins.rows[0].stock_number);
          rowQty = ins.rows[0].quantity;
        }
        await sql`
          INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, notes, changed_by)
          VALUES (${rowId}, ${rowStockNumber}, 'import', null, ${rowQty}, 'General import', ${changedBy ?? null})
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
  opts?: { notes?: string; changed_by?: string; taken_by?: string; brought_by?: string }
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
    newQty = current.quantity - amount;
    newPhysical = Math.max(0, (current.physical_quantity ?? current.quantity) - amount);
  } else if (type === 'set_system') {
    newQty = amount;
    // physical stays unchanged for manual system overrides
  } else if (type === 'count') {
    newPhysical = amount;
    // system qty stays unchanged — mismatch will be flagged
  }

  const takenBy = type === 'subtract' && opts?.taken_by ? opts.taken_by : null;
  const broughtBy = type === 'add' && opts?.brought_by ? opts.brought_by : null;

  const result = await sql`
    UPDATE stock_items SET
      quantity = ${newQty},
      physical_quantity = ${newPhysical},
      released_to = COALESCE(${takenBy}::text, released_to),
      received_by = COALESCE(${broughtBy}::text, received_by),
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
      ${opts?.notes ?? null}, ${opts?.changed_by ?? null}
    )
  `;

  return mapRow(result.rows[0]);
}

export async function moveItemLocation(id: string, newLocation: string | null, changedBy?: string): Promise<StockItem> {
  const current = await getStockItem(id);
  if (!current) throw new Error('Item not found');
  const from = current.location || '(none)';
  const to = newLocation || '(none)';
  const result = await sql`UPDATE stock_items SET location = ${newLocation}, updated_at = NOW() WHERE id = ${id} RETURNING *`;
  await sql`
    INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, notes, changed_by)
    VALUES (${id}, ${current.stock_number}, 'move', ${current.quantity}, ${current.quantity}, ${`Moved: ${from} → ${to}`}, ${changedBy ?? null})
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
  items: { id: string; physical_quantity: number }[],
  changedBy?: string
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
        INSERT INTO stock_history (stock_item_id, stock_number, change_type, quantity_before, quantity_after, physical_before, physical_after, notes, changed_by)
        VALUES (${id}, ${current.stock_number}, 'count', ${current.quantity}, ${current.quantity}, ${current.physical_quantity ?? null}, ${physical_quantity}, 'Bulk count update', ${changedBy ?? null})
      `;
      updated++;
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { updated, errors };
}

export async function getDistinctValues(field: 'category' | 'location' | 'rack_number' | 'stored_by' | 'released_to' | 'received_by'): Promise<string[]> {
  const result = await sql.query(
    `SELECT DISTINCT ${field} FROM stock_items WHERE ${field} IS NOT NULL AND ${field} != '' ORDER BY ${field}`,
    []
  );
  return result.rows.map((r) => String(r[field]));
}
