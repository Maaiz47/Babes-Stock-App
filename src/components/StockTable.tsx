'use client';
import { useState } from 'react';
import type { StockItem } from '@/lib/types';
import { formatDate, STATUS_LABELS, STATUS_COLORS, cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog } from './ui/dialog';
import { useToast } from './ui/toast';
import {
  Pencil, Trash2, AlertTriangle, ChevronUp, ChevronDown,
  ChevronsUpDown, MapPin, Hash, User, Calendar,
  ArrowUpDown, Package
} from 'lucide-react';

type SortKey = keyof Pick<StockItem, 'stock_number' | 'name' | 'quantity' | 'status' | 'date_added' | 'date_removed' | 'rack_number' | 'category'>;
type SortDir = 'asc' | 'desc';

interface Props {
  items: StockItem[];
  loading: boolean;
  selectedIds: string[];
  onSelectChange: (ids: string[]) => void;
  onEdit: (item: StockItem) => void;
  onRefresh: () => void;
}

export function StockTable({ items, loading, selectedIds, onSelectChange, onEdit, onRefresh }: Props) {
  const { success, error: toastError } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('date_added');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    let cmp = 0;
    if (sortKey === 'quantity') cmp = Number(av) - Number(bv);
    else cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < items.length;

  const toggleAll = () => {
    if (allSelected) onSelectChange([]);
    else onSelectChange(items.map((i) => i.id));
  };

  const toggleItem = (id: string) => {
    if (selectedIds.includes(id)) onSelectChange(selectedIds.filter((x) => x !== id));
    else onSelectChange([...selectedIds, id]);
  };

  const deleteItem = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/stock/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      success('Item deleted');
      onRefresh();
    } catch (e) {
      toastError('Delete failed', String(e));
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const SortIcon = ({ key }: { key: SortKey }) => {
    if (sortKey !== key) return <ChevronsUpDown size={12} className="text-gray-600" />;
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-violet-400" />
      : <ChevronDown size={12} className="text-violet-400" />;
  };

  const ColHeader = ({ label, sortK }: { label: string; sortK?: SortKey }) => (
    <th
      className={cn('px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide', sortK && 'cursor-pointer hover:text-gray-300')}
      onClick={() => sortK && toggleSort(sortK)}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {sortK && <SortIcon key={sortK} />}
      </span>
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading inventory…</p>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Package size={40} className="text-gray-700" />
        <p className="text-gray-500 text-sm">No items found</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead className="bg-white/3">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="rounded border-white/20 bg-white/10 accent-violet-500 cursor-pointer"
                />
              </th>
              <ColHeader label="Stock #" sortK="stock_number" />
              <ColHeader label="Name" sortK="name" />
              <ColHeader label="Category" sortK="category" />
              <ColHeader label="Rack" sortK="rack_number" />
              <ColHeader label="Qty" sortK="quantity" />
              <ColHeader label="Status" sortK="status" />
              <ColHeader label="Date Added" sortK="date_added" />
              <ColHeader label="Date Removed" sortK="date_removed" />
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sorted.map((item) => {
              const selected = selectedIds.includes(item.id);
              const expanded = expandedId === item.id;
              return (
                <>
                  <tr
                    key={item.id}
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    className={cn(
                      'group cursor-pointer transition-colors',
                      selected ? 'bg-violet-500/8' : 'hover:bg-white/3',
                      item.quantity_mismatch && 'border-l-2 border-l-amber-500'
                    )}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleItem(item.id)}
                        className="rounded border-white/20 bg-white/10 accent-violet-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-300">{item.stock_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-100">{item.name}</span>
                        {item.quantity_mismatch && (
                          <AlertTriangle size={13} className="text-amber-400 shrink-0" aria-label="Quantity mismatch" />
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-gray-500 truncate max-w-xs mt-0.5">{item.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{item.category || '—'}</td>
                    <td className="px-4 py-3">
                      {item.rack_number
                        ? <span className="inline-flex items-center gap-1 text-xs text-gray-300"><MapPin size={11} className="text-gray-500" />{item.rack_number}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-100">{item.quantity}</span>
                        {item.physical_quantity !== null && item.physical_quantity !== undefined && (
                          <span className={cn(
                            'text-xs px-1.5 py-0.5 rounded font-mono',
                            item.quantity_mismatch
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-emerald-500/15 text-emerald-400'
                          )}>
                            /{item.physical_quantity}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(item.date_added)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(item.date_removed)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)}>
                          <Pencil size={13} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" className="hover:text-red-400 hover:bg-red-500/10" onClick={() => setDeleteId(item.id)}>
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${item.id}-detail`} className={cn('bg-white/2', selected && 'bg-violet-500/5')}>
                      <td />
                      <td colSpan={9} className="px-4 py-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <p className="text-gray-500 flex items-center gap-1 mb-0.5"><User size={11} /> Stored By</p>
                            <p className="text-gray-300">{item.stored_by || '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 flex items-center gap-1 mb-0.5"><User size={11} /> Released To</p>
                            <p className="text-gray-300">{item.released_to || '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500 flex items-center gap-1 mb-0.5"><User size={11} /> Received By</p>
                            <p className="text-gray-300">{item.received_by || '—'}</p>
                          </div>
                          {item.notes && (
                            <div className="col-span-2 md:col-span-1">
                              <p className="text-gray-500 mb-0.5">Notes</p>
                              <p className="text-gray-300">{item.notes}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Item" size="sm">
        <p className="text-gray-300 text-sm mb-5">Permanently delete this item? This cannot be undone.</p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => deleteId && deleteItem(deleteId)} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
