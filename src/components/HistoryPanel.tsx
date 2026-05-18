'use client';
import { useState, useEffect } from 'react';
import type { HistoryEntry } from '@/lib/db';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, History, ArrowUp, ArrowDown, Hash, ClipboardList, Package } from 'lucide-react';

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  add: { label: 'Added', icon: <ArrowUp size={12} />, color: 'text-emerald-400 bg-emerald-500/10' },
  subtract: { label: 'Removed', icon: <ArrowDown size={12} />, color: 'text-red-400 bg-red-500/10' },
  set_system: { label: 'Set Qty', icon: <Hash size={12} />, color: 'text-blue-400 bg-blue-500/10' },
  count: { label: 'Count', icon: <ClipboardList size={12} />, color: 'text-amber-400 bg-amber-500/10' },
  release: { label: 'Released', icon: <ArrowDown size={12} />, color: 'text-orange-400 bg-orange-500/10' },
  import: { label: 'Imported', icon: <Package size={12} />, color: 'text-violet-400 bg-violet-500/10' },
  create: { label: 'Created', icon: <Package size={12} />, color: 'text-gray-400 bg-white/5' },
  edit: { label: 'Edited', icon: <Hash size={12} />, color: 'text-gray-400 bg-white/5' },
};

export function HistoryPanel({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && history.length === 0) {
      setLoading(true);
      fetch(`/api/stock/${itemId}/history`)
        .then(r => r.json())
        .then(j => setHistory(j.history ?? []))
        .finally(() => setLoading(false));
    }
  }, [open, itemId]);

  return (
    <div className="border border-white/8 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/4 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <History size={14} className="text-gray-500" />
          Change History
          {history.length > 0 && (
            <span className="text-xs text-gray-500">({history.length})</span>
          )}
        </span>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>

      {open && (
        <div className="border-t border-white/8 max-h-56 overflow-y-auto">
          {loading && <p className="text-xs text-gray-500 text-center py-6">Loading…</p>}
          {!loading && history.length === 0 && <p className="text-xs text-gray-500 text-center py-6">No history yet</p>}
          {history.map((h) => {
            const meta = TYPE_META[h.change_type] ?? TYPE_META.edit;
            return (
              <div key={h.id} className="flex items-start gap-3 px-4 py-2.5 border-t border-white/5 first:border-t-0">
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 mt-0.5', meta.color)}>
                  {meta.icon} {meta.label}
                </span>
                <div className="flex-1 min-w-0 text-xs">
                  {(h.quantity_before != null || h.quantity_after != null) && h.change_type !== 'count' && (
                    <p className="text-gray-300">
                      System: <span className="text-gray-500">{h.quantity_before ?? '?'}</span>
                      {' → '}
                      <strong className="text-white">{h.quantity_after ?? '?'}</strong>
                      {h.delta != null && (
                        <span className={cn('ml-1 font-mono', h.delta > 0 ? 'text-emerald-400' : 'text-red-400')}>
                          ({h.delta > 0 ? '+' : ''}{h.delta})
                        </span>
                      )}
                    </p>
                  )}
                  {h.change_type === 'count' && (
                    <p className="text-gray-300">
                      Physical: <span className="text-gray-500">{h.physical_before ?? '?'}</span>
                      {' → '}
                      <strong className={cn(h.physical_after !== h.quantity_after ? 'text-amber-400' : 'text-emerald-400')}>
                        {h.physical_after ?? '?'}
                      </strong>
                    </p>
                  )}
                  {h.notes && <p className="text-gray-500 mt-0.5 truncate">{h.notes}</p>}
                </div>
                <span className="text-[10px] text-gray-600 shrink-0 mt-0.5">{formatRelative(h.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
