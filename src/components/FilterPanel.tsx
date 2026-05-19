'use client';
import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import type { StockFilters } from '@/lib/types';
import { SlidersHorizontal, X, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const EMPTY: StockFilters = {
  search: '', status: '', category: '', location: '', rack_number: '',
  date_added_from: '', date_added_to: '',
  date_removed_from: '', date_removed_to: '',
  stored_by: '', released_to: '', received_by: '',
  mismatch_only: false, mismatch_type: '',
};

interface Props {
  filters: StockFilters;
  onChange: (f: StockFilters) => void;
  categories: string[];
  locations: string[];
  racks: string[];
}

export function FilterPanel({ filters, onChange, categories, locations, racks }: Props) {
  const [open, setOpen] = useState(false);

  const activeCount = Object.entries(filters).filter(([k, v]) => {
    if (k === 'search') return false;
    return v !== '' && v !== false;
  }).length;

  const set = (key: keyof StockFilters, value: string | boolean) =>
    onChange({ ...filters, [key]: value });

  const clear = () => onChange(EMPTY);

  return (
    <div className="bg-gray-900/50 border border-white/8 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/4 transition-colors"
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={15} className="text-gray-400" />
          <span className="font-medium text-gray-200">Filters</span>
          {activeCount > 0 && (
            <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-[10px] px-1.5 py-0">
              {activeCount}
            </Badge>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/8 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <Select value={filters.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">All Statuses</option>
                <option value="in-stock">In Stock</option>
                <option value="low-stock">Low Stock</option>
                <option value="reserved">Reserved</option>
                <option value="removed">Removed</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Location</label>
              <Select value={filters.location} onChange={(e) => set('location', e.target.value)}>
                <option value="">All Locations</option>
                {locations.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <Select value={filters.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">All Categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Rack</label>
              <Select value={filters.rack_number} onChange={(e) => set('rack_number', e.target.value)}>
                <option value="">All Racks</option>
                {racks.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date Added — From</label>
              <Input type="date" value={filters.date_added_from} onChange={(e) => set('date_added_from', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date Added — To</label>
              <Input type="date" value={filters.date_added_to} onChange={(e) => set('date_added_to', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date Removed — From</label>
              <Input type="date" value={filters.date_removed_from} onChange={(e) => set('date_removed_from', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date Removed — To</label>
              <Input type="date" value={filters.date_removed_to} onChange={(e) => set('date_removed_to', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stored By</label>
              <Input placeholder="Name…" value={filters.stored_by} onChange={(e) => set('stored_by', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Released To</label>
              <Input placeholder="Name…" value={filters.released_to} onChange={(e) => set('released_to', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Received By</label>
              <Input placeholder="Name…" value={filters.received_by} onChange={(e) => set('received_by', e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white transition-colors">
              <div
                onClick={() => onChange({ ...filters, mismatch_only: !filters.mismatch_only, mismatch_type: '' })}
                className={cn(
                  'w-8 h-4.5 rounded-full border transition-colors flex items-center px-0.5 cursor-pointer',
                  filters.mismatch_only
                    ? 'bg-amber-500 border-amber-500'
                    : 'bg-white/10 border-white/20'
                )}
              >
                <div className={cn(
                  'w-3.5 h-3.5 rounded-full bg-white transition-transform',
                  filters.mismatch_only ? 'translate-x-3' : 'translate-x-0'
                )} />
              </div>
              <AlertTriangle size={13} className="text-amber-400" />
              Quantity mismatches only
            </label>

            {activeCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clear} className="text-xs gap-1">
                <X size={12} /> Clear filters
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
