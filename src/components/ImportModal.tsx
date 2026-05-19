'use client';
import { useState, useRef, useCallback } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { useToast } from './ui/toast';
import { DB_FIELDS, parseNumericField } from '@/lib/utils';
import type { StockItemInput, ImportRow, ColumnMapping } from '@/lib/types';
import type { ImportMode } from '@/lib/db';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Upload, AlertCircle, CheckCircle2, ClipboardList, PackageOpen, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'upload' | 'header' | 'map' | 'preview' | 'done';
type RawRow = (string | number | null | undefined)[];

const MODES: { value: ImportMode; label: string; icon: React.ReactNode; hint: string }[] = [
  {
    value: 'count',
    label: 'Stock Count',
    icon: <ClipboardList size={20} />,
    hint: 'Updates physical count. Flags mismatches vs system quantity. System quantity is preserved for existing items.',
  },
  {
    value: 'release',
    label: 'Stock Release',
    icon: <PackageOpen size={20} />,
    hint: 'Records who stock was released to and received by. Updates system quantity for existing items.',
  },
  {
    value: 'general',
    label: 'General Import',
    icon: <Layers size={20} />,
    hint: 'Full upsert — all mapped columns are written. Use this to initially load stock data.',
  },
];

const ALL_STEPS: Step[] = ['upload', 'header', 'map', 'preview', 'done'];
const STEP_LABELS: Record<Step, string> = {
  upload: 'Upload',
  header: 'Header Row',
  map: 'Map Columns',
  preview: 'Preview',
  done: 'Done',
};

export function ImportModal({ open, onClose, onImported }: Props) {
  const { success, error: toastError, warning } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [mode, setMode] = useState<ImportMode>('count');
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [result, setResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setMode('count');
    setRawRows([]);
    setHeaderRowIdx(0);
    setRows([]);
    setHeaders([]);
    setMappings([]);
    setResult(null);
  };

  const processFile = (file: File) => {
    const isCSV = file.name.endsWith('.csv') || file.type === 'text/csv';
    const isExcel = file.name.match(/\.(xlsx|xls)$/);

    if (isCSV) {
      Papa.parse<RawRow>(file, {
        header: false,
        skipEmptyLines: false,
        complete: (res) => {
          if (res.data.length === 0) { toastError('Empty file', 'No data found'); return; }
          setRawRows(res.data as RawRow[]);
          setHeaderRowIdx(0);
          setStep('header');
        },
        error: () => toastError('Parse error', 'Could not parse CSV file'),
      });
    } else if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<RawRow>(ws, { header: 1, raw: false, defval: '' });
        if (json.length === 0) { toastError('Empty file', 'No data found'); return; }
        setRawRows(json as RawRow[]);
        setHeaderRowIdx(0);
        setStep('header');
      };
      reader.readAsArrayBuffer(file);
    } else {
      toastError('Unsupported file', 'Please upload a .csv, .xlsx or .xls file');
    }
  };

  const confirmHeaderRow = () => {
    const hdrs = (rawRows[headerRowIdx] ?? [])
      .map((cell) => String(cell ?? '').trim())
      .filter((h) => h !== '');

    const dataRaws = rawRows
      .slice(headerRowIdx + 1)
      .filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''));

    const data: ImportRow[] = dataRaws.map((row) => {
      const obj: ImportRow = {};
      hdrs.forEach((h, i) => { obj[h] = String(row[i] ?? '').trim(); });
      return obj;
    });

    setHeaders(hdrs);
    setRows(data);
    setMappings(hdrs.map((h) => ({ csvColumn: h, dbField: autoMap(h, mode) })));
    setStep('map');
  };

  const autoMap = (header: string, m: ImportMode): keyof StockItemInput | '' => {
    const h = header.toLowerCase().replace(/[\s_-]+/g, '_');
    const qtyField: keyof StockItemInput = m === 'count' ? 'physical_quantity' : 'quantity';
    const map: Record<string, keyof StockItemInput> = {
      stock_number: 'stock_number', stock_no: 'stock_number', sku: 'stock_number', id: 'stock_number',
      name: 'name', item: 'name', product: 'name', title: 'name',
      description: 'description', desc: 'description',
      category: 'category', type: 'category',
      rack: 'rack_number', rack_number: 'rack_number',
      location: 'location', warehouse: 'location',
      quantity: qtyField, qty: qtyField, count: qtyField, stock: qtyField,
      physical_quantity: 'physical_quantity', physical_count: 'physical_quantity', actual_qty: 'physical_quantity',
      system_quantity: 'quantity', system_qty: 'quantity', system_stock: 'quantity',
      status: 'status',
      date_added: 'date_added', added: 'date_added', date: 'date_added',
      date_removed: 'date_removed', removed: 'date_removed',
      released_to: 'released_to', released: 'released_to', recipient: 'released_to',
      received_by: 'received_by', received: 'received_by', receiver: 'received_by',
      stored_by: 'stored_by', stored: 'stored_by',
      notes: 'notes', comments: 'notes', remarks: 'notes',
    };
    return map[h] ?? '';
  };

  const setMapping = (csvColumn: string, dbField: keyof StockItemInput | '') => {
    setMappings((prev) => prev.map((m) => m.csvColumn === csvColumn ? { ...m, dbField } : m));
  };

  const normaliseStatus = (raw: string | undefined): StockItemInput['status'] => {
    const s = (raw ?? '').toLowerCase().replace(/[\s_-]+/g, '');
    if (s.includes('low') || s.includes('lowstock')) return 'low-stock';
    if (s.includes('remov') || s.includes('sold') || s.includes('gone') || s.includes('unavail') || s.includes('repurchase')) return 'removed';
    if (s.includes('reserv') || s.includes('held') || s.includes('pending')) return 'reserved';
    return 'in-stock';
  };

  const buildItems = (): { items: StockItemInput[]; warnings: string[] } => {
    const today = new Date().toISOString().split('T')[0];
    const warnings: string[] = [];
    const items: StockItemInput[] = rows.map((row, i) => {
      const item: Partial<StockItemInput> = {};
      for (const m of mappings) {
        if (!m.dbField) continue;
        const val = String(row[m.csvColumn] ?? '').trim();
        if (m.dbField === 'quantity' || m.dbField === 'physical_quantity') {
          (item as Record<string, unknown>)[m.dbField] = parseNumericField(val) || null;
        } else {
          (item as Record<string, unknown>)[m.dbField] = val || null;
        }
      }
      if (!item.stock_number) {
        item.stock_number = `IMP-${Date.now()}-${i}`;
        warnings.push(`Row ${i + 1}: No stock number, generated ${item.stock_number}`);
      }
      if (!item.name) {
        item.name = item.stock_number!;
        warnings.push(`Row ${i + 1}: No name, using stock number`);
      }
      return {
        stock_number: item.stock_number!,
        name: item.name!,
        description: item.description ?? undefined,
        category: item.category ?? undefined,
        location: (item.location as string | null | undefined) ?? null,
        rack_number: item.rack_number ?? undefined,
        quantity: Number(item.quantity ?? 0),
        physical_quantity: item.physical_quantity != null ? Number(item.physical_quantity) : null,
        status: normaliseStatus(item.status as string | undefined),
        date_added: item.date_added || today,
        date_removed: item.date_removed ?? null,
        released_to: item.released_to ?? null,
        received_by: item.received_by ?? null,
        stored_by: item.stored_by ?? null,
        notes: item.notes ?? null,
      };
    });
    return { items, warnings };
  };

  const doImport = async () => {
    const { items, warnings } = buildItems();
    if (warnings.length > 0) warning('Import warnings', `${warnings.length} auto-fix(es) applied`);
    setImporting(true);
    try {
      const res = await fetch('/api/stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', items, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setResult(json);
      setStep('done');
      if (json.created > 0) { success('Import complete', `${json.created} items imported`); onImported(); }
    } catch (e) {
      toastError('Import failed', String(e));
    } finally {
      setImporting(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const requiredMapped = mappings.some((m) => m.dbField === 'stock_number') &&
    mappings.some((m) => m.dbField === 'name');

  const { items: previewItems } = step === 'preview' ? buildItems() : { items: [] };

  // For the header picker: show up to 8 raw rows, truncate cell values
  const previewRawRows = rawRows.slice(0, 8);
  const maxCols = Math.min(6, Math.max(...previewRawRows.map((r) => r.length)));

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import Stock from CSV / Excel"
      size="2xl"
    >
      {/* Step indicator */}
      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto">
        {ALL_STEPS.map((s, i) => {
          const active = s === step;
          const past = ALL_STEPS.indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-1.5 shrink-0">
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                active ? 'bg-violet-500 text-white' : past ? 'bg-emerald-500 text-white' : 'bg-white/10 text-gray-500'
              )}>
                {past ? <CheckCircle2 size={12} /> : i + 1}
              </div>
              <span className={cn('text-xs whitespace-nowrap', active ? 'text-white font-medium' : 'text-gray-500')}>
                {STEP_LABELS[s]}
              </span>
              {i < ALL_STEPS.length - 1 && <div className="w-4 h-px bg-white/10 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* ── Upload ── */}
      {step === 'upload' && (
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Import Type</p>
            <div className="grid grid-cols-1 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={cn(
                    'flex items-start gap-3 w-full rounded-xl border px-4 py-3 text-left transition-all',
                    mode === m.value ? 'border-violet-500/60 bg-violet-500/10' : 'border-white/8 bg-white/3 hover:bg-white/6'
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', mode === m.value ? 'text-violet-400' : 'text-gray-500')}>{m.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold', mode === m.value ? 'text-white' : 'text-gray-300')}>{m.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{m.hint}</p>
                  </div>
                  <div className={cn('w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition-all', mode === m.value ? 'border-violet-400 bg-violet-400' : 'border-white/20')} />
                </button>
              ))}
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
              dragging ? 'border-violet-400 bg-violet-500/10' : 'border-white/15 hover:border-white/30 hover:bg-white/4'
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0]); }}
            />
            <Upload size={28} className="mx-auto mb-3 text-gray-500" />
            <p className="text-sm font-medium text-gray-300">Drop your file here, or tap to browse</p>
            <p className="mt-1 text-xs text-gray-500">Supports .csv, .xlsx, .xls</p>
          </div>
        </div>
      )}

      {/* ── Header Row Picker ── */}
      {step === 'header' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl bg-violet-500/8 border border-violet-500/20 px-3 py-2.5">
            <AlertCircle size={14} className="text-violet-400 shrink-0 mt-0.5" />
            <p className="text-xs text-violet-300">
              Click the row that contains your <strong>column headings</strong>. Rows above it will be skipped; rows below become data.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/8">
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-12">Row</th>
                  {Array.from({ length: maxCols }).map((_, ci) => (
                    <th key={ci} className="px-3 py-2 text-left text-gray-600 font-normal">col {ci + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRawRows.map((row, ri) => {
                  const isSelected = ri === headerRowIdx;
                  const isAbove = ri < headerRowIdx;
                  return (
                    <tr
                      key={ri}
                      onClick={() => setHeaderRowIdx(ri)}
                      className={cn(
                        'border-t border-white/5 cursor-pointer transition-colors',
                        isSelected
                          ? 'bg-violet-500/15 hover:bg-violet-500/20'
                          : isAbove
                          ? 'opacity-40 hover:bg-white/3'
                          : 'hover:bg-white/3'
                      )}
                    >
                      <td className="px-3 py-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600 tabular-nums w-4">{ri + 1}</span>
                          {isSelected && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-violet-400 bg-violet-500/20 rounded px-1 py-0.5 whitespace-nowrap">
                              headers
                            </span>
                          )}
                        </div>
                      </td>
                      {Array.from({ length: maxCols }).map((_, ci) => {
                        const cell = String(row[ci] ?? '').trim();
                        return (
                          <td
                            key={ci}
                            className={cn(
                              'px-3 py-2 max-w-[120px] truncate',
                              isSelected ? 'text-white font-medium' : isAbove ? 'text-gray-500' : 'text-gray-400'
                            )}
                          >
                            {cell || <span className="text-gray-700 italic">empty</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {rawRows.length > 8 && (
                  <tr className="border-t border-white/5">
                    <td colSpan={maxCols + 1} className="px-3 py-2 text-center text-gray-600 text-[10px]">
                      … {rawRows.length - 8} more rows not shown
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            Row <strong className="text-violet-400">{headerRowIdx + 1}</strong> selected as header ·{' '}
            <strong className="text-white">{rawRows.length - headerRowIdx - 1}</strong> data rows will be imported
          </p>

          <div className="flex gap-3 justify-end pt-2 border-t border-white/8">
            <Button variant="ghost" onClick={reset}>Back</Button>
            <Button onClick={confirmHeaderRow}>Use row {headerRowIdx + 1} as headers →</Button>
          </div>
        </div>
      )}

      {/* ── Map Columns ── */}
      {step === 'map' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-400">{rows.length} data rows found. Map your columns to the correct fields.</p>
          <div className="space-y-2">
            {mappings.map((m) => (
              <div key={m.csvColumn} className="flex items-center gap-3">
                <div className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono truncate">
                  {m.csvColumn}
                  <span className="ml-2 text-gray-600">
                    {rows[0]?.[m.csvColumn] ? `"${String(rows[0][m.csvColumn]).slice(0, 20)}"` : ''}
                  </span>
                </div>
                <span className="text-gray-600 text-sm">→</span>
                <div className="flex-1">
                  <Select value={m.dbField} onChange={(e) => setMapping(m.csvColumn, e.target.value as keyof StockItemInput | '')}>
                    {DB_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>
          {!requiredMapped && (
            <div className="flex items-center gap-2 text-amber-400 text-xs">
              <AlertCircle size={13} /> Map at least <strong>Stock Number</strong> and <strong>Name</strong> to proceed
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-white/8 sticky bottom-0 bg-gray-900 pb-1">
            <Button variant="ghost" onClick={() => setStep('header')}>Back</Button>
            <Button onClick={() => setStep('preview')} disabled={!requiredMapped}>Preview →</Button>
          </div>
        </div>
      )}

      {/* ── Preview ── */}
      {step === 'preview' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-400">Preview of first 5 rows. Ready to import {rows.length} items.</p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/5">
                  {['Stock #', 'Name', 'Category', 'Rack', 'Qty', 'Status', 'Date Added'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewItems.slice(0, 5).map((item, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/4">
                    <td className="px-3 py-2 text-gray-300 font-mono">{item.stock_number}</td>
                    <td className="px-3 py-2 text-gray-200">{item.name}</td>
                    <td className="px-3 py-2 text-gray-400">{item.category || '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{item.rack_number || '—'}</td>
                    <td className="px-3 py-2 text-gray-300">{item.quantity}</td>
                    <td className="px-3 py-2 text-gray-400">{item.status}</td>
                    <td className="px-3 py-2 text-gray-400">{item.date_added}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && <p className="text-xs text-gray-500 text-center">…and {rows.length - 5} more</p>}

          <div className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
            mode === 'count' ? 'bg-blue-500/10 text-blue-300' :
            mode === 'release' ? 'bg-amber-500/10 text-amber-300' :
            'bg-white/5 text-gray-400'
          )}>
            {MODES.find((m) => m.value === mode)?.icon}
            <span><strong>{MODES.find((m) => m.value === mode)?.label}:</strong> {MODES.find((m) => m.value === mode)?.hint}</span>
          </div>

          <div className="flex gap-3 justify-end pt-2 border-t border-white/8 sticky bottom-0 bg-gray-900 pb-1">
            <Button variant="ghost" onClick={() => setStep('map')}>Back</Button>
            <Button onClick={doImport} disabled={importing}>
              {importing ? 'Importing…' : `Import ${rows.length} Items`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && result && (
        <div className="text-center py-4 space-y-4">
          <CheckCircle2 size={40} className="mx-auto text-emerald-400" />
          <div>
            <p className="text-lg font-semibold text-white">{result.created} items imported</p>
            {result.errors.length > 0 && (
              <div className="mt-3 text-left">
                <p className="text-xs text-red-400 font-medium mb-1">{result.errors.length} error(s):</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-gray-500 font-mono">{e}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="ghost" onClick={reset}>Import More</Button>
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
