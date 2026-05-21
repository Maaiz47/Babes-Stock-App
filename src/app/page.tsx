'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StockTable } from '@/components/StockTable';
import { StockForm } from '@/components/StockForm';
import { FilterPanel } from '@/components/FilterPanel';
import { BulkActions } from '@/components/BulkActions';
import { ImportModal } from '@/components/ImportModal';
import { ExportModal } from '@/components/ExportModal';
import { QuickAdjust } from '@/components/QuickAdjust';
import { Celebration } from '@/components/ui/celebration';
import { TutorialModal } from '@/components/TutorialModal';
import { CountSheetModal } from '@/components/CountSheetModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { StockItem, StockFilters } from '@/lib/types';
import {
  Plus, Upload, RefreshCw, Search, AlertTriangle,
  Package, TrendingDown, TrendingUp, Download, HelpCircle, LogOut, Shield, User, ClipboardList
} from 'lucide-react';
import { cn } from '@/lib/utils';

const EMPTY_FILTERS: StockFilters = {
  search: '', status: '', category: '', location: '', rack_number: '',
  date_added_from: '', date_added_to: '',
  date_removed_from: '', date_removed_to: '',
  stored_by: '', released_to: '', received_by: '',
  mismatch_only: false, mismatch_type: '',
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
  const [exportOpen, setExportOpen] = useState(false);
  const [quickItem, setQuickItem] = useState<StockItem | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [globalStats, setGlobalStats] = useState<{ total: number; in_stock: number; low_stock: number; mismatches: number; missing: number; excess: number } | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [racks, setRacks] = useState<string[]>([]);
  const [splashPhase, setSplashPhase] = useState<'show' | 'fade' | 'done'>('show');
  const [celebrating, setCelebrating] = useState(false);
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
    try {
      const [catRes, locRes, rackRes, countRes, statsRes] = await Promise.all([
        fetch('/api/stock?distinct=category'),
        fetch('/api/stock?distinct=location'),
        fetch('/api/stock?distinct=rack_number'),
        fetch('/api/stock?count=true'),
        fetch('/api/stock?stats=true'),
      ]);
      const [cat, loc, rack, countJson, statsJson] = await Promise.all([catRes.json(), locRes.json(), rackRes.json(), countRes.json(), statsRes.json()]);
      setCategories(cat.values ?? []);
      setLocations(loc.values ?? []);
      setRacks(rack.values ?? []);
      setTotalCount(countJson.count ?? null);
      setGlobalStats(statsJson.stats ?? null);
    } catch {
      // supplementary data — silently ignore failures
    }
  }, [dbReady]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setCurrentUser(d.user));
  }, []);
  useEffect(() => { initDB(); }, [initDB]);
  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchDistinct(); }, [fetchDistinct]);

  // Dismiss splash once DB is ready and first fetch is done
  useEffect(() => {
    if (dbReady && !loading && splashPhase === 'show') {
      setSplashPhase('fade');
      const t = setTimeout(() => setSplashPhase('done'), 500);
      return () => clearTimeout(t);
    }
  }, [dbReady, loading, splashPhase]);

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
    inStock: globalStats?.in_stock ?? items.filter((i) => i.status === 'in-stock').length,
    lowStock: globalStats?.low_stock ?? items.filter((i) => i.status === 'low-stock').length,
    mismatches: globalStats?.mismatches ?? items.filter((i) => i.quantity_mismatch).length,
    missing: globalStats?.missing ?? items.filter((i) => i.mismatch_type === 'missing').length,
    excess: globalStats?.excess ?? items.filter((i) => i.mismatch_type === 'excess').length,
  };

  const setStatFilter = (patch: Partial<StockFilters>) =>
    setFilters((f) => ({ ...EMPTY_FILTERS, ...patch }));
  const isFiltered = Object.entries(filters).some(([k, v]) => k !== 'search' && v !== '' && v !== false);

  return (
    <div className="min-h-screen bg-[#080810]">
      {splashPhase !== 'done' && (
        <div className={cn(
          'fixed inset-0 z-[100] bg-[#080810] overflow-hidden transition-opacity duration-500',
          splashPhase === 'fade' ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}>
          {([
            { left:  '1%', top: '76%', size: 60, delay: 0.04, twist: '-23deg' },
            { left: '13%', top: '80%', size: 48, delay: 0.19, twist:  '18deg' },
            { left: '25%', top: '74%', size: 64, delay: 0,    twist:  '-9deg' },
            { left: '38%', top: '78%', size: 52, delay: 0.14, twist:  '28deg' },
            { left: '51%', top: '75%', size: 56, delay: 0.06, twist: '-17deg' },
            { left: '63%', top: '79%', size: 44, delay: 0.25, twist:  '15deg' },
            { left: '75%', top: '76%', size: 60, delay: 0.10, twist: '-31deg' },
            { left: '87%', top: '73%', size: 44, delay: 0.29, twist:  '22deg' },
            { left:  '6%', top: '88%', size: 52, delay: 0.36, twist:  '12deg' },
            { left: '22%', top: '86%', size: 40, delay: 0.44, twist: '-19deg' },
            { left: '42%', top: '90%', size: 56, delay: 0.32, twist:  '26deg' },
            { left: '60%', top: '87%', size: 44, delay: 0.40, twist:  '-8deg' },
            { left: '78%', top: '89%', size: 48, delay: 0.48, twist:  '20deg' },
          ] as { left: string; top: string; size: number; delay: number; twist: string }[]).map((b, i) => (
            /* outer div: static position + rotation — never animated */
            <div
              key={i}
              style={{
                position: 'absolute',
                left: b.left,
                top: b.top,
                fontSize: b.size,
                lineHeight: 1,
                userSelect: 'none',
                transform: `rotate(${b.twist})`,
              }}
            >
              {/* inner span: translateY animation only — no CSS custom props */}
              <span style={{ display: 'block', animation: `splash-fall 1s ease-in ${b.delay}s both` }}>
                📦
              </span>
            </div>
          ))}

          {/* Title fades in while boxes are mid-fall */}
          <div className="absolute inset-x-0 flex justify-center" style={{ top: '35%', transform: 'translateY(-50%)' }}>
            <div className="flex flex-col items-center gap-2" style={{ animation: 'splash-fade-up 0.5s ease-out 0.3s both' }}>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-2xl shadow-violet-500/40">
                <Package size={26} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">Babes Stock</h1>
              <p className="text-sm text-gray-500">Inventory Manager</p>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#080810]/80 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Package size={16} className="text-white" />
            </div>
            <div className="hidden xs:block sm:block">
              <h1 className="text-sm font-semibold text-white leading-none">Babes Stock</h1>
              <p className="text-[10px] text-gray-500 leading-none mt-0.5">Inventory Manager</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            {/* Desktop: username + admin text button */}
            {currentUser && (
              <div className="hidden sm:flex items-center gap-2 mr-1">
                <button
                  type="button"
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
            {/* Mobile: admin shield icon */}
            {currentUser?.isAdmin && (
              <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => router.push('/admin')} title="Admin Panel">
                <Shield size={15} className="text-violet-400" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setTutorialOpen(true)} title="Help & Tutorial">
              <HelpCircle size={15} />
            </Button>
            <Button variant="ghost" size="icon" onClick={refresh} title="Refresh">
              <RefreshCw size={15} />
            </Button>
            <Button variant="ghost" size="icon" title="Log out"
              onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); }}
            >
              <LogOut size={15} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCountSheetOpen(true)} className="hidden sm:flex">
              <ClipboardList size={14} /> Count Sheet
            </Button>
            <Button variant="outline" size="icon" onClick={() => setExportOpen(true)} className="sm:hidden" title="Export">
              <Download size={14} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)} className="hidden sm:flex">
              <Download size={14} /> Export
            </Button>
            <Button size="sm" onClick={() => { setEditItem(null); setTemplateItem(null); setFormOpen(true); }}>
              <Plus size={14} />
              <span className="hidden sm:inline">Add Item</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* Stats row */}
        {(() => {
          const statCards = [
            { label: 'All Items', value: totalCount ?? stats.total, icon: Package, color: 'text-gray-400', onClick: () => setFilters(EMPTY_FILTERS), active: !isFiltered },
            { label: 'In Stock', value: stats.inStock, icon: Package, color: 'text-emerald-400', onClick: () => setStatFilter({ status: 'in-stock' }), active: filters.status === 'in-stock' && !filters.mismatch_only && !filters.mismatch_type },
            { label: 'Low Stock', value: stats.lowStock, icon: TrendingDown, color: 'text-amber-400', onClick: () => setStatFilter({ status: 'low-stock' }), active: filters.status === 'low-stock' && !filters.mismatch_type },
            { label: 'Missing', value: stats.missing, icon: AlertTriangle, color: 'text-red-400', onClick: () => setStatFilter({ mismatch_type: 'missing' }), active: filters.mismatch_type === 'missing' },
            { label: 'Excess', value: stats.excess, icon: TrendingUp, color: 'text-teal-400', onClick: () => setStatFilter({ mismatch_type: 'excess' }), active: filters.mismatch_type === 'excess' },
          ];
          return (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {statCards.map(({ label, value, icon: Icon, color, onClick, active }, i) => (
              <button
                type="button"
                key={label}
                onClick={onClick}
                className={cn(
                  'text-left bg-white/3 border rounded-xl px-4 py-3 transition-colors hover:bg-white/6 active:bg-white/8',
                  active ? 'border-violet-500/40 bg-violet-500/8' : 'border-white/8',
                  i === statCards.length - 1 && statCards.length % 2 !== 0 && 'col-span-2 md:col-span-1'
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
          );
        })()}

        {/* Search + Filters */}
        <div className="flex flex-col gap-2">
          <div className="w-full">
            <Input
              icon={<Search size={14} />}
              placeholder="Search by name, stock number, description…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          {items.length > 0 && selectedIds.length === 0 && (filters.search || Object.values(filters).some(v => v !== '' && v !== false)) && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(items.map(i => i.id))}>
                Select all {items.length}
              </Button>
            </div>
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

      <QuickAdjust item={quickItem} onClose={() => setQuickItem(null)} onSaved={refresh} onMismatchResolved={() => setCelebrating(true)} locations={locations} />
      {celebrating && <Celebration onDone={() => setCelebrating(false)} />}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={refresh}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        items={items}
        selectedIds={selectedIds}
        isFiltered={isFiltered}
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
