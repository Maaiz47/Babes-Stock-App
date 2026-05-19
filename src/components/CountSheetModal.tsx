'use client';
import { useState, useMemo } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Select } from './ui/select';
import type { StockItem } from '@/lib/types';
import { ClipboardList, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

interface Props {
  open: boolean;
  onClose: () => void;
  items: StockItem[];
  locations: string[];
  racks: string[];
  categories: string[];
}

export function CountSheetModal({ open, onClose, items, locations, racks, categories }: Props) {
  const [filterLocation, setFilterLocation] = useState('');
  const [filterRack, setFilterRack] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filterLocation && i.location !== filterLocation) return false;
      if (filterRack && i.rack_number !== filterRack) return false;
      if (filterCategory && i.category !== filterCategory) return false;
      if (filterStatus && i.status !== filterStatus) return false;
      return true;
    });
  }, [items, filterLocation, filterRack, filterCategory, filterStatus]);

  const buildRows = () =>
    filtered.map((i) => ({
      'Stock Number': i.stock_number,
      'Name': i.name,
      'Description': i.description ?? '',
      'Category': i.category ?? '',
      'Location': i.location ?? '',
      'Rack Number': i.rack_number ?? '',
      'System Quantity': i.quantity,
      'Physical Count': '',
      'Notes': i.notes ?? '',
    }));

  const exportXLSX = () => {
    const rows = buildRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    // Style the Physical Count column header to draw attention
    ws['H1'] = { v: 'Physical Count', t: 's' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Count Sheet');
    XLSX.writeFile(wb, `count-sheet-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportCSV = () => {
    const rows = buildRows();
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `count-sheet-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setFilterLocation('');
    setFilterRack('');
    setFilterCategory('');
    setFilterStatus('');
  };

  return (
    <Dialog open={open} onClose={onClose} title="Export Count Sheet" size="lg">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl bg-blue-500/8 border border-blue-500/20 px-4 py-3">
          <ClipboardList size={16} className="text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300">
            Export a count sheet to take to the warehouse. Fill in the <strong>Physical Count</strong> column on-site, then import it back using <strong>Import → Stock Count</strong> to record the counts.
          </p>
        </div>

        {/* Filters */}
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Filter items to include</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Location</label>
              <Select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Rack</label>
              <Select value={filterRack} onChange={(e) => setFilterRack(e.target.value)}>
                <option value="">All racks</option>
                {racks.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Category</label>
              <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Status</label>
              <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="in-stock">In Stock</option>
                <option value="low-stock">Low Stock</option>
                <option value="reserved">Reserved</option>
                <option value="removed">Removed</option>
              </Select>
            </div>
          </div>
          {(filterLocation || filterRack || filterCategory || filterStatus) && (
            <button onClick={resetFilters} className="mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Clear filters
            </button>
          )}
        </div>

        {/* Preview count */}
        <div className="flex items-center justify-between bg-white/3 border border-white/8 rounded-xl px-4 py-3">
          <span className="text-sm text-gray-300">Items to export</span>
          <span className="text-2xl font-bold text-white">{filtered.length}</span>
        </div>

        {filtered.length === 0 && (
          <p className="text-xs text-gray-500 text-center">No items match the selected filters.</p>
        )}

        {/* Export buttons */}
        <div className="flex gap-3 pt-2 border-t border-white/8">
          <Button variant="ghost" onClick={onClose} className="mr-auto">Cancel</Button>
          <Button
            variant="outline"
            onClick={exportCSV}
            disabled={filtered.length === 0}
          >
            <FileText size={14} /> CSV
          </Button>
          <Button
            onClick={exportXLSX}
            disabled={filtered.length === 0}
          >
            <Download size={14} /> Excel (.xlsx)
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
