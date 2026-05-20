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

export function formatDateSmart(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays === -1) return 'Tomorrow';
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < -1 && diffDays > -7) return `In ${-diffDays} days`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDatePreset(preset: 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'thisYear'): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toStr = toISODate(today);
  switch (preset) {
    case 'today':     return { from: toStr, to: toStr };
    case 'yesterday': { const y = new Date(today); y.setDate(today.getDate() - 1); const ys = toISODate(y); return { from: ys, to: ys }; }
    case 'last7':     { const f = new Date(today); f.setDate(today.getDate() - 6);  return { from: toISODate(f), to: toStr }; }
    case 'last30':    { const f = new Date(today); f.setDate(today.getDate() - 29); return { from: toISODate(f), to: toStr }; }
    case 'thisMonth': { const f = new Date(today.getFullYear(), today.getMonth(), 1); return { from: toISODate(f), to: toStr }; }
    case 'thisYear':  { const f = new Date(today.getFullYear(), 0, 1); return { from: toISODate(f), to: toStr }; }
  }
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
