export type StockStatus = 'in-stock' | 'low-stock' | 'removed' | 'reserved';

export interface StockItem {
  id: string;
  stock_number: string;
  name: string;
  description?: string;
  category?: string;
  location?: string | null;
  rack_number?: string;
  quantity: number;
  location_total?: number;   // ← add this line
  physical_quantity?: number | null;
  quantity_mismatch: boolean;
  mismatch_type: 'excess' | 'missing' | null;
  status: StockStatus;
  date_added: string;
  date_removed?: string | null;
  released_to?: string | null;
  received_by?: string | null;
  stored_by?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockItemInput {
  stock_number: string;
  name: string;
  description?: string;
  category?: string;
  location?: string | null;
  rack_number?: string;
  quantity: number;
  physical_quantity?: number | null;
  status: StockStatus;
  date_added: string;
  date_removed?: string | null;
  released_to?: string | null;
  received_by?: string | null;
  stored_by?: string | null;
  notes?: string | null;
}

export interface StockFilters {
  search: string;
  status: string;
  category: string;
  location: string;
  rack_number: string;
  date_added_from: string;
  date_added_to: string;
  date_removed_from: string;
  date_removed_to: string;
  stored_by: string;
  released_to: string;
  received_by: string;
  mismatch_only: boolean;
  mismatch_type: string;
}

export interface BulkActionPayload {
  ids: string[];
  action: 'delete' | 'update_status' | 'update_physical_qty';
  data?: {
    status?: StockStatus;
    physical_quantity?: number;
  };
}

export interface ImportRow {
  [key: string]: string;
}

export interface ColumnMapping {
  csvColumn: string;
  dbField: keyof StockItemInput | '';
}
