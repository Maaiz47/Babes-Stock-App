'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StockTable } from '@/components/StockTable';
import { StockForm } from '@/components/StockForm';
import { FilterPanel } from '@/components/FilterPanel';
import { BulkActions } from '@/components/BulkActions';
import { ImportModal } from '@/components/ImportModal';
import { QuickAdjust } from '@/components/QuickAdjust';
import { TutorialModal } from '@/components/TutorialModal';
import { CountSheetModal } from '@/components/CountSheetModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { StockItem, StockFilters } from '@/lib/types';
import {
  Plus, Upload, RefreshCw, Search, AlertTriangle,
  Package, TrendingDown, Archive, HelpCircle, LogOut, Shield, User, ClipboardList
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { formatDate, STATUS_LABELS, cn } from '@/lib/utils';

const EMPTY_FILTERS: StockFilters = {
  search: '', status: '', category: '', location: '', rack_number: '',
  date_added_from: '', date_added_to: '',
  date_removed_from: '', date_removed_to: '',
  stored_by: '', released_to: '', received_by: '',
  mismatch_only: false,
};

interface SessionUser { userId: string; username: string; email: string; isAdmin: boolean; }

export default function HomePage() {
  const { error: toastError } = useToast();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [filters, setFilters] = useState<StockFilters>(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [templateItem, setTemplateItem] = useState<StockItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [quickItem, setQuickItem] = useState<StockItem | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [racks, setRacks] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initDB = useCallback(async () => {
    try {
      await fetch('/api/init');
      setDbReady(true);
    } catch {
      toastError('DB init failed', 'Check your database connection');
    }
  }, [toastError]);

  const fetchItems = useCallback(async (silent = false) => {
    if (!dbReady) return;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v !== false) params.set(k, String(v));
      });
      const res = await fetch(`/api/stock?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setItems(json.items);
    } catch (e) {
      if (!silent) toastError('Fetch failed', String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [dbReady, filters, toastError]);

  const fetchDistinct = useCallback(async () => {
    if (!dbReady) return;
    const [catRes, locRes, rackRes, countRes] = await Promise.all([
      fetch('/api/stock?distinct=category'),
      fetch('/api/stock?distinct=location'),
      fetch('/api/stock?distinct=rack_number'),
      fetch('/api/stock?count=true'),
    ]);
    const [cat, loc, rack, countJson] = await Promise.all([catRes.json(), locRes.json(), rackRes.json(), countRes.json()]);
    setCategories(cat.values ?? []);
    setLocations(loc.values ?? []);
    setRacks(rack.values ?? []);
    setTotalCount(countJson.count ?? null);
  }, [dbReady]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setCurrentUser(d.user));
  }, []);
  useEffect(() => { initDB(); }, [initDB]);
  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchDistinct(); }, [fetchDistinct]);

  // Poll every 30s for real-time feel
  useEffect(() => {
    if (!dbReady) return;
    pollRef.current = setInterval(() => fetchItems(true), 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [dbReady, fetchItems]);

  const refresh = () => {
    fetchItems();
    fetchDistinct();
    setSelectedIds([]);
  };

  const stats = {
    total: items.length,
    inStock: items.filter((i) => i.status === 'in-stock').length,
    lowStock: items.filter((i) => i.status === 'low-stock').length,
    mismatches: items.filter((i) => i.quantity_mismatch).length,
  };

  const setStatFilter = (patch: Partial<StockFilters>) =>
    setFilters((f) => ({ ...EMPTY_FILTERS, ...patch }));
  const isFiltered = Object.entries(filters).some(([k, v]) => k !== 'search' && v !== '' && v !== false);

  const exportAll = () => {
    const data = items.map((r) => ({
      'Stock Number': r.stock_number,
      'Name': r.name,
      'Description': r.description ?? '',
      'Category': r.category ?? '',
      'Location': r.location ?? '',
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
    XLSX.writeFile(wb, `stock-full-export-${Date.now()}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#080810]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#080810]/80 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Package size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white leading-none">Babes Stock</h1>
              <p className="text-[10px] text-gray-500 leading-none mt-0.5">Inventory Manager</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 mr-1">
                <button
                  onClick={() => router.push('/settings')}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors px-2 py-1 rounded-lg hover:bg-white/8"
                >
                  {currentUser.isAdmin ? <Shield size={12} className="text-violet-400" /> : <User size={12} />}
                  <span className="text-gray-300">{currentUser.username}</span>
                </button>
                {currentUser.isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => router.push('/admin')} className="text-xs h-7 px-2">
                    Admin
                  </Button>
                )}
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={() => setTutorialOpen(true)} title="Help & Tutorial">
              <HelpCircle size={15} />
            </Button>
            <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
              <RefreshCw size={15} />
            </Button>
            <Button
              variant="ghost" size="icon"
              title="Log out"
              onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); }}
            >
              <LogOut size={15} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCountSheetOpen(true)}>
              <ClipboardList size={14} /> Count Sheet
            </Button>
            <Button variant="outline" size="sm" onClick={exportAll}>
              <Archive size={14} /> Export All
            </Button>
            <Button size="sm" onClick={() => { setEditItem(null); setTemplateItem(null); setFormOpen(true); }}>
              <Plus size={14} /> Add Item
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-5">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'All Items', value: totalCount ?? stats.total, icon: Package, color: 'text-gray-400', onClick: () => setFilters(EMPTY_FILTERS), active: !isFiltered },
            { label: 'In Stock', value: stats.inStock, icon: Package, color: 'text-emerald-400', onClick: () => setStatFilter({ status: 'in-stock' }), active: filters.status === 'in-stock' && !filters.mismatch_only },
            { label: 'Low Stock', value: stats.lowStock, icon: TrendingDown, color: 'text-amber-400', onClick: () => setStatFilter({ status: 'low-stock' }), active: filters.status === 'low-stock' },
            { label: 'Mismatches', value: stats.mismatches, icon: AlertTriangle, color: 'text-amber-400', onClick: () => setStatFilter({ mismatch_only: true }), active: filters.mismatch_only },
          ].map(({ label, value, icon: Icon, color, onClick, active }) => (
            <button
              key={label}
              onClick={onClick}
              className={cn(
                'text-left bg-white/3 border rounded-xl px-4 py-3 transition-colors hover:bg-white/6 active:bg-white/8',
                active ? 'border-violet-500/40 bg-violet-500/8' : 'border-white/8'
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{label}</span>
                <Icon size={14} className={color} />
              </div>
              <p className="text-2xl font-bold text-white">{value}</p>
            </button>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              icon={<Search size={14} />}
              placeholder="Search by name, stock number, description…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          {items.length > 0 && selectedIds.length === 0 && (filters.search || Object.values(filters).some(v => v !== '' && v !== false)) && (
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(items.map(i => i.id))}>
              Select all {items.length}
            </Button>
          )}
          {stats.mismatches > 0 && (
            <Button
              variant={filters.mismatch_only ? 'warning' : 'outline'}
              size="sm"
              onClick={() => setFilters((f) => ({ ...f, mismatch_only: !f.mismatch_only }))}
            >
              <AlertTriangle size={13} />
              {stats.mismatches} Mismatch{stats.mismatches !== 1 ? 'es' : ''}
            </Button>
          )}
        </div>

        <FilterPanel
          filters={filters}
          onChange={setFilters}
          categories={categories}
          locations={locations}
          racks={racks}
        />

        {/* Bulk actions */}
        <BulkActions
          selectedIds={selectedIds}
          allItems={items}
          onDone={refresh}
          onClearSelection={() => setSelectedIds([])}
        />

        {/* Table */}
        <StockTable
          items={items}
          loading={loading}
          selectedIds={selectedIds}
          onSelectChange={setSelectedIds}
          onEdit={(item) => { setEditItem(item); setTemplateItem(null); setFormOpen(true); }}
          onDuplicate={(item) => { setEditItem(null); setTemplateItem(item); setFormOpen(true); }}
          onQuickAdjust={(item) => setQuickItem(item)}
          onRefresh={refresh}
        />

        <p className="text-center text-xs text-gray-600 pb-4">
          {items.length} item{items.length !== 1 ? 's' : ''} · Auto-refreshes every 30s
        </p>
      </main>

      <StockForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setTemplateItem(null); }}
        onSaved={refresh}
        item={editItem}
        template={templateItem}
        locations={locations}
      />

      <QuickAdjust item={quickItem} onClose={() => setQuickItem(null)} onSaved={refresh} />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
      />

      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <CountSheetModal
        open={countSheetOpen}
        onClose={() => setCountSheetOpen(false)}
        items={items}
        locations={locations}
        racks={racks}
        categories={categories}
      />
    </div>
  );
}
