'use client';
import { useMemo, useState } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { useToast } from './ui/toast';
import type { StockItem } from '@/lib/types';
import { formatDate, STATUS_LABELS, cn } from '@/lib/utils';
import { FileSpreadsheet, FileText, Download, CheckSquare, Square } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface Props {
  open: boolean;
  onClose: () => void;
  items: StockItem[];
  selectedIds: string[];
  isFiltered: boolean;
}

type Format = 'xlsx' | 'csv';
type Scope = 'view' | 'selected';

interface Column {
  key: string;
  label: string;
  get: (r: StockItem) => string | number;
}

const COLUMNS: Column[] = [
  { key: 'stock_number',     label: 'Stock Number',    get: (r) => r.stock_number },
  { key: 'name',             label: 'Name',            get: (r) => r.name },
  { key: 'description',      label: 'Description',     get: (r) => r.description ?? '' },
  { key: 'category',         label: 'Category',        get: (r) => r.category ?? '' },
  { key: 'location',         label: 'Location',        get: (r) => r.location ?? '' },
  { key: 'rack_number',      label: 'Rack Number',     get: (r) => r.rack_number ?? '' },
  { key: 'quantity',         label: 'Quantity',        get: (r) => r.quantity },
  { key: 'physical_quantity',label: 'Physical Count',  get: (r) => r.physical_quantity ?? '' },
  { key: 'quantity_mismatch',label: 'Mismatch',        get: (r) => (r.quantity_mismatch ? 'YES' : 'NO') },
  { key: 'mismatch_type',    label: 'Mismatch Type',   get: (r) => r.mismatch_type ?? '' },
  { key: 'status',           label: 'Status',          get: (r) => STATUS_LABELS[r.status] },
  { key: 'date_added',       label: 'Date Added',      get: (r) => formatDate(r.date_added) },
  { key: 'date_removed',     label: 'Date Removed',    get: (r) => formatDate(r.date_removed) },
  { key: 'stored_by',        label: 'Stored By',       get: (r) => r.stored_by ?? '' },
  { key: 'released_to',      label: 'Released To',     get: (r) => r.released_to ?? '' },
  { key: 'received_by',      label: 'Received By',     get: (r) => r.received_by ?? '' },
  { key: 'notes',            label: 'Notes',           get: (r) => r.notes ?? '' },
];

const DEFAULT_KEYS = new Set([
  'stock_number', 'name', 'category', 'location', 'rack_number',
  'quantity', 'physical_quantity', 'quantity_mismatch', 'status',
  'date_added', 'date_removed', 'stored_by', 'released_to', 'received_by', 'notes',
]);

export function ExportModal({ open, onClose, items, selectedIds, isFiltered }: Props) {
  const { success, error: toastError } = useToast();
  const [format, setFormat] = useState<Format>('xlsx');
  const [scope, setScope] = useState<Scope>(selectedIds.length > 0 ? 'selected' : 'view');
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_KEYS));

  const exportItems = useMemo(() => {
    if (scope === 'selected' && selectedIds.length > 0) {
      const sel = new Set(selectedIds);
      return items.filter((i) => sel.has(i.id));
    }
    return items;
  }, [items, selectedIds, scope]);

  const toggleCol = (key: string) =>
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allChecked = selectedCols.size === COLUMNS.length;
  const noneChecked = selectedCols.size === 0;
  const toggleAll = () =>
    setSelectedCols(allChecked ? new Set() : new Set(COLUMNS.map((c) => c.key)));

  const handleExport = () => {
    if (noneChecked) {
      toastError('No columns selected', 'Pick at least one column to export');
      return;
    }
    if (exportItems.length === 0) {
      toastError('Nothing to export', 'No items in the chosen scope');
      return;
    }

    const cols = COLUMNS.filter((c) => selectedCols.has(c.key));
    const rows = exportItems.map((item) => {
      const row: Record<string, string | number> = {};
      for (const c of cols) row[c.label] = c.get(item);
      return row;
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const scopeTag = scope === 'selected' ? 'selected' : (isFiltered ? 'filtered' : 'all');
    const base = `stock-${scopeTag}-${stamp}`;

    try {
      if (format === 'csv') {
        const csv = Papa.unparse(rows, { columns: cols.map((c) => c.label) });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${base}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const ws = XLSX.utils.json_to_sheet(rows, { header: cols.map((c) => c.label) });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stock');
        XLSX.writeFile(wb, `${base}.xlsx`);
      }
      success('Export ready', `${exportItems.length} item${exportItems.length === 1 ? '' : 's'} · ${cols.length} column${cols.length === 1 ? '' : 's'}`);
      onClose();
    } catch (e) {
      toastError('Export failed', String(e));
    }
  };

  const scopeLabel = scope === 'selected'
    ? `${selectedIds.length} selected`
    : isFiltered ? `${items.length} (current filter)` : `${items.length} (all)`;

  return (
    <Dialog open={open} onClose={onClose} title="Export Stock" description="Choose what to export and how" size="xl">
      <div className="space-y-5">
        {/* Format */}
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Format</p>
          <div className="grid grid-cols-2 gap-2">
            <FormatCard
              active={format === 'xlsx'}
              onClick={() => setFormat('xlsx')}
              icon={<FileSpreadsheet size={18} />}
              label="Excel"
              hint=".xlsx · spreadsheet"
            />
            <FormatCard
              active={format === 'csv'}
              onClick={() => setFormat('csv')}
              icon={<FileText size={18} />}
              label="CSV"
              hint=".csv · plain text"
            />
          </div>
        </div>

        {/* Scope */}
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Rows</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ScopeCard
              active={scope === 'view'}
              onClick={() => setScope('view')}
              title={isFiltered ? 'Current filter' : 'All items'}
              hint={`${items.length} item${items.length === 1 ? '' : 's'}`}
            />
            <ScopeCard
              active={scope === 'selected'}
              onClick={() => selectedIds.length > 0 && setScope('selected')}
              disabled={selectedIds.length === 0}
              title="Selected only"
              hint={selectedIds.length === 0 ? 'Nothing selected' : `${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}`}
            />
          </div>
        </div>

        {/* Columns */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Columns <span className="text-gray-500 normal-case font-normal">· {selectedCols.size} of {COLUMNS.length}</span>
            </p>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-violet-400 hover:text-violet-300 font-medium"
            >
              {allChecked ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto pr-1">
            {COLUMNS.map((c) => {
              const checked = selectedCols.has(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleCol(c.key)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors',
                    checked
                      ? 'border-violet-500/40 bg-violet-500/10 text-white'
                      : 'border-white/8 bg-white/3 hover:bg-white/6 text-gray-300'
                  )}
                >
                  {checked
                    ? <CheckSquare size={15} className="text-violet-400 shrink-0" />
                    : <Square size={15} className="text-gray-500 shrink-0" />}
                  <span className="truncate">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-white/8">
          <p className="text-xs text-gray-500">
            Exporting <span className="text-gray-300 font-medium">{scopeLabel}</span> as{' '}
            <span className="text-gray-300 font-medium uppercase">{format}</span>
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleExport} disabled={noneChecked || exportItems.length === 0}>
              <Download size={14} />
              Export {exportItems.length || ''}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function FormatCard({ active, onClick, icon, label, hint }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
        active ? 'border-violet-500/60 bg-violet-500/10' : 'border-white/8 bg-white/3 hover:bg-white/6'
      )}
    >
      <span className={cn('shrink-0', active ? 'text-violet-400' : 'text-gray-500')}>{icon}</span>
      <div className="min-w-0">
        <p className={cn('text-sm font-semibold', active ? 'text-white' : 'text-gray-300')}>{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>
    </button>
  );
}

function ScopeCard({ active, onClick, title, hint, disabled }: {
  active: boolean; onClick: () => void; title: string; hint: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-all',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && active && 'border-violet-500/60 bg-violet-500/10',
        !disabled && !active && 'border-white/8 bg-white/3 hover:bg-white/6'
      )}
    >
      <div className="min-w-0">
        <p className={cn('text-sm font-semibold', active && !disabled ? 'text-white' : 'text-gray-300')}>{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      </div>
      <div className={cn(
        'w-4 h-4 rounded-full border-2 shrink-0 transition-all',
        !disabled && active ? 'border-violet-400 bg-violet-400' : 'border-white/20'
      )} />
    </button>
  );
}
