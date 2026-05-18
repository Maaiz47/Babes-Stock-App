'use client';
import { useState, useEffect } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import type { StockItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

interface CountRow {
  id: string;
  stock_number: string;
  name: string;
  system_qty: number;
  physical_qty: number; // editable
  original_physical: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  selectedItems: StockItem[];
}

export function BulkCountModal({ open, onClose, onDone, selectedItems }: Props) {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState<CountRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(selectedItems.map(item => ({
        id: item.id,
        stock_number: item.stock_number,
        name: item.name,
        system_qty: item.quantity,
        // Default to existing physical count, fall back to system qty
        physical_qty: item.physical_quantity ?? item.quantity,
        original_physical: item.physical_quantity ?? null,
      })));
    }
  }, [open, selectedItems]);

  const setQty = (id: string, val: number) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, physical_qty: Math.max(0, val) } : r));
  };

  const mismatches = rows.filter(r => r.physical_qty !== r.system_qty).length;
  const changed = rows.filter(r => r.physical_qty !== (r.original_physical ?? r.system_qty)).length;

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_count',
          items: rows.map(r => ({ id: r.id, physical_quantity: r.physical_qty })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      success('Physical counts updated', `${json.updated} items saved${mismatches > 0 ? `, ${mismatches} mismatches flagged` : ''}`);
      onDone();
      onClose();
    } catch (e) {
      toastError('Failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Bulk Physical Count" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{rows.length} items · tap +/− to adjust each count</span>
          {mismatches > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle size={12} /> {mismatches} mismatch{mismatches !== 1 ? 'es' : ''}
            </span>
          )}
        </div>

        {/* Item list */}
        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {rows.map(row => {
            const mismatch = row.physical_qty !== row.system_qty;
            const isChanged = row.physical_qty !== (row.original_physical ?? row.system_qty);
            return (
              <div
                key={row.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors',
                  mismatch ? 'border-amber-500/25 bg-amber-500/5' : 'border-white/8 bg-white/3'
                )}
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-gray-500 shrink-0">{row.stock_number}</span>
                    {mismatch && <AlertTriangle size={11} className="text-amber-400 shrink-0" />}
                    {isChanged && !mismatch && <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />}
                  </div>
                  <p className="text-sm font-medium text-gray-100 truncate">{row.name}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    System: <span className="text-gray-400">{row.system_qty}</span>
                    {row.original_physical != null && row.original_physical !== row.system_qty && (
                      <span className="ml-2 text-amber-500">prev physical: {row.original_physical}</span>
                    )}
                  </p>
                </div>

                {/* Stepper */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setQty(row.id, row.physical_qty - 1)}
                    className="w-9 h-9 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all font-bold text-base"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={row.physical_qty}
                    onChange={e => setQty(row.id, parseInt(e.target.value) || 0)}
                    className={cn(
                      'w-16 text-center text-base font-bold rounded-lg py-1.5 border focus:outline-none focus:ring-2 focus:ring-violet-500/50 bg-white/5',
                      mismatch ? 'text-amber-400 border-amber-500/30' : isChanged ? 'text-emerald-400 border-emerald-500/30' : 'text-white border-white/10'
                    )}
                  />
                  <button
                    onClick={() => setQty(row.id, row.physical_qty + 1)}
                    className="w-9 h-9 rounded-lg bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all font-bold text-base"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary + confirm */}
        <div className="border-t border-white/8 pt-3 space-y-3">
          {mismatches > 0 && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              {mismatches} item{mismatches !== 1 ? 's' : ''} will be flagged as mismatch after saving
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={submit} disabled={saving} className="flex-1">
              {saving ? 'Saving…' : `Save ${rows.length} Counts`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
