import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { StockItem, StockStatus } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const STATUS_LABELS: Record<StockStatus, string> = {
  'in-stock': 'In Stock',
  'low-stock': 'Low Stock',
  'removed': 'Removed',
  'reserved': 'Reserved',
};

export const STATUS_COLORS: Record<StockStatus, string> = {
  'in-stock': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  'low-stock': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'removed': 'bg-red-500/15 text-red-400 border-red-500/30',
  'reserved': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

export const DB_FIELDS: { value: keyof StockItem | ''; label: string; required?: boolean }[] = [
  { value: '', label: '— Skip column —' },
  { value: 'stock_number', label: 'Stock Number *', required: true },
  { value: 'name', label: 'Name *', required: true },
  { value: 'description', label: 'Description' },
  { value: 'category', label: 'Category' },
  { value: 'location', label: 'Location' },
  { value: 'rack_number', label: 'Rack Number' },
  { value: 'quantity', label: 'System Quantity' },
  { value: 'physical_quantity', label: 'Physical Count' },
  { value: 'status', label: 'Status' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'date_removed', label: 'Date Removed' },
  { value: 'released_to', label: 'Released To' },
  { value: 'received_by', label: 'Received By' },
  { value: 'stored_by', label: 'Stored By' },
  { value: 'notes', label: 'Notes' },
];

export function generateStockNumber(): string {
  const prefix = 'STK';
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${prefix}-${timestamp}`;
}

export function parseNumericField(val: string | undefined): number {
  if (!val) return 0;
  const n = parseInt(val.trim(), 10);
  return isNaN(n) ? 0 : n;
}
