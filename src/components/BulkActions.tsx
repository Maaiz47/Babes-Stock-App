'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { useToast } from './ui/toast';
import type { StockStatus } from '@/lib/types';
import { Trash2, Tag, Hash, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { StockItem } from '@/lib/types';
import { formatDate, STATUS_LABELS } from '@/lib/utils';

interface Props {
  selectedIds: string[];
  allItems: StockItem[];
  onDone: () => void;
  onClearSelection: () => void;
}

export function BulkActions({ selectedIds, allItems, onDone, onClearSelection }: Props) {
  const { success, error: toastError } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);
  const [qtyDialog, setQtyDialog] = useState(false);
  const [newStatus, setNewStatus] = useState<StockStatus>('in-stock');
  const [newQty, setNewQty] = useState('');
  const [loading, setLoading] = useState(false);

  const count = selectedIds.length;

  const doAction = async (action: string, data?: object) => {
    setLoading(true);
    try {
      const res = await fetch('/api/stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids: selectedIds, data }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      success(`Done`, `${json.affected} item(s) updated`);
      onClearSelection();
      onDone();
    } catch (e) {
      toastError('Action failed', String(e));
    } finally {
      setLoading(false);
    }
  };

  const exportSelected = () => {
    const rows = allItems.filter((i) => selectedIds.includes(i.id));
    const data = rows.map((r) => ({
      'Stock Number': r.stock_number,
      'Name': r.name,
      'Description': r.description ?? '',
      'Category': r.category ?? '',
      'Rack Number': r.rack_number ?? '',
      'Quantity': r.quantity,
      'Physical Count': r.physical_quantity ?? '',
      'Mismatch': r.quantity_mismatch ? 'YES' : 'NO',
      'Status': STATUS_LABELS[r.status],
      'Date Added': formatDate(r.date_added),
      'Date Removed': formatDate(r.date_removed),
      'Stored By': r.stored_by ?? '',
      'Released To': r.released_to ?? '',
      'Received By': r.received_by ?? '',
      'Notes': r.notes ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock');
    XLSX.writeFile(wb, `stock-export-${Date.now()}.xlsx`);
    success('Exported', `${rows.length} items exported`);
  };

  if (count === 0) return null;

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/10 border border-violet-500/20 rounded-xl">
        <span className="text-sm font-medium text-violet-300">{count} selected</span>
        <div className="flex-1 flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setStatusDialog(true)} disabled={loading}>
            <Tag size={13} /> Set Status
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQtyDialog(true)} disabled={loading}>
            <Hash size={13} /> Physical Count
          </Button>
          <Button variant="outline" size="sm" onClick={exportSelected} disabled={loading}>
            <Download size={13} /> Export
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} disabled={loading}>
            <Trash2 size={13} /> Delete
          </Button>
        </div>
        <button onClick={onClearSelection} className="text-xs text-violet-400 hover:text-violet-200 transition-colors">
          Clear
        </button>
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Selected" size="sm">
        <p className="text-gray-300 text-sm mb-5">
          Permanently delete <strong className="text-white">{count}</strong> item(s)? This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="destructive" onClick={async () => { await doAction('delete'); setConfirmDelete(false); }} disabled={loading}>
            {loading ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>

      <Dialog open={statusDialog} onClose={() => setStatusDialog(false)} title="Update Status" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">New status for {count} item(s)</label>
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value as StockStatus)}>
              <option value="in-stock">In Stock</option>
              <option value="low-stock">Low Stock</option>
              <option value="reserved">Reserved</option>
              <option value="removed">Removed</option>
            </Select>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setStatusDialog(false)}>Cancel</Button>
            <Button onClick={async () => { await doAction('update_status', { status: newStatus }); setStatusDialog(false); }} disabled={loading}>
              {loading ? 'Updating…' : 'Update'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={qtyDialog} onClose={() => setQtyDialog(false)} title="Update Physical Count" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Physical count for {count} item(s)</label>
            <Input
              type="number"
              min={0}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              placeholder="Enter count…"
              autoFocus
            />
            <p className="mt-1.5 text-xs text-gray-500">Items where this differs from system quantity will be flagged.</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setQtyDialog(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                const q = parseInt(newQty, 10);
                if (isNaN(q)) return;
                await doAction('update_physical_qty', { physical_quantity: q });
                setQtyDialog(false);
                setNewQty('');
              }}
              disabled={loading || newQty === ''}
            >
              {loading ? 'Updating…' : 'Update Count'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
