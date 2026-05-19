'use client';
import { useState } from 'react';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import {
  Package, Minus, Plus, Hash, ClipboardList, Pencil, Copy,
  Upload, Download, Tag, AlertTriangle, MapPin, Building2,
  ChevronRight, ChevronLeft, CheckCircle2, TrendingUp, ArrowRightLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

const steps: Step[] = [
  {
    title: 'Overview',
    icon: <Package size={18} />,
    content: (
      <div className="space-y-3">
        <p className="text-gray-300 text-sm">Babes Stock tracks inventory across locations with both <strong className="text-white">system quantities</strong> (the official record) and <strong className="text-white">physical counts</strong> (what you actually count on the shelf). Discrepancies are automatically flagged.</p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {[
            ['All Items', 'Total items in the system · click to clear all filters'],
            ['In Stock', 'Click to filter to in-stock items only'],
            ['Low Stock', 'Click to filter to low-stock items'],
            ['Missing', 'Physical count is lower than system qty — stock may have walked out'],
            ['Excess', 'Physical count is higher than system qty — unlogged deliveries'],
          ].map(([label, desc]) => (
            <div key={label} className="bg-white/4 border border-white/8 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-violet-300">{label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: 'Tap vs Hold on a Row',
    icon: <Pencil size={18} />,
    content: (
      <div className="space-y-4">
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <div className="mt-0.5 text-violet-400 shrink-0"><Package size={16} /></div>
          <div>
            <p className="text-sm font-semibold text-white">Tap a row</p>
            <p className="text-xs text-gray-400 mt-0.5">Opens the <strong className="text-white">Quick Adjust</strong> bottom sheet — fast +/− for quantity changes, physical counts, or stock releases.</p>
          </div>
        </div>
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <div className="mt-0.5 text-amber-400 shrink-0"><Pencil size={16} /></div>
          <div>
            <p className="text-sm font-semibold text-white">Hold a row (500ms)</p>
            <p className="text-xs text-gray-400 mt-0.5">Opens the <strong className="text-white">full edit form</strong> — change name, category, location, rack, status, dates, personnel, notes.</p>
          </div>
        </div>
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <div className="mt-0.5 text-violet-400 shrink-0"><Copy size={16} /></div>
          <div>
            <p className="text-sm font-semibold text-white">Duplicate button (copy icon)</p>
            <p className="text-xs text-gray-400 mt-0.5">Creates a new item pre-filled with the same details but a fresh stock number — useful when the same item exists at multiple warehouses.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: 'Quick Adjust Actions',
    icon: <Minus size={18} />,
    content: (
      <div className="space-y-3">
        <p className="text-xs text-gray-500 mb-3">Tap any row to open Quick Adjust. Five action types:</p>
        {[
          { icon: <Minus size={14} />, color: 'text-red-400', label: 'Remove', desc: 'Reduces both system AND physical qty. Requires "Taken by" name. Can go negative — warns you before confirming.' },
          { icon: <Plus size={14} />, color: 'text-emerald-400', label: 'Add', desc: 'Increases both system AND physical qty. Optional "Brought by" field records who delivered the stock.' },
          { icon: <ClipboardList size={14} />, color: 'text-amber-400', label: 'Count', desc: 'Updates physical qty only — system qty stays unchanged. Any difference is flagged as missing or excess.' },
          { icon: <Hash size={14} />, color: 'text-blue-400', label: 'Set Qty', desc: 'Direct system quantity override. Use carefully — physical count stays the same, likely creating a mismatch.' },
          { icon: <ArrowRightLeft size={14} />, color: 'text-indigo-400', label: 'Move Location', desc: 'Reassigns the item to a different warehouse or office. Quantities are unchanged — pick from existing locations or type a new one.' },
        ].map(({ icon, color, label, desc }) => (
          <div key={label} className="flex gap-3 items-start">
            <span className={cn('mt-0.5 shrink-0', color)}>{icon}</span>
            <div>
              <span className="text-sm font-semibold text-white">{label} </span>
              <span className="text-xs text-gray-400">{desc}</span>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Locations & Racks',
    icon: <Building2 size={18} />,
    content: (
      <div className="space-y-4">
        <p className="text-sm text-gray-300">Two separate location fields let you track where items live at different levels:</p>
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <Building2 size={16} className="text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Location</p>
            <p className="text-xs text-gray-400 mt-0.5">The warehouse or office — e.g. <em>Warehouse A</em>, <em>Head Office</em>. Type to set a new one or pick from existing. Shown in violet in the table.</p>
          </div>
        </div>
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <MapPin size={16} className="text-gray-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Rack Number</p>
            <p className="text-xs text-gray-400 mt-0.5">The specific shelf or rack within that location — e.g. <em>A-12</em>, <em>Shelf 3B</em>.</p>
          </div>
        </div>
        <p className="text-xs text-gray-500">Both fields appear in the filter panel and exports. Use the duplicate button to create the same item for a second warehouse.</p>
      </div>
    ),
  },
  {
    title: 'Quantity Mismatches',
    icon: <AlertTriangle size={18} />,
    content: (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">Mismatches are split into two types — colour-coded throughout the table:</p>
        <div className="space-y-2">
          <div className="flex gap-3 items-start bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
            <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-300">Missing — physical &lt; system</p>
              <p className="text-xs text-gray-400 mt-0.5">The physical count is lower than the system record. Red left border, red badge, red triangle icon on the row. Stock may have been removed without logging.</p>
            </div>
          </div>
          <div className="flex gap-3 items-start bg-teal-500/8 border border-teal-500/20 rounded-xl px-4 py-3">
            <TrendingUp size={14} className="text-teal-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-teal-300">Excess — physical &gt; system</p>
              <p className="text-xs text-gray-400 mt-0.5">The physical count is higher than the system record. Teal left border, teal badge, trending-up icon. Usually means an unlogged delivery arrived.</p>
            </div>
          </div>
        </div>
        <div className="bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <p className="text-xs text-gray-400 font-semibold mb-1">Common causes</p>
          <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
            <li>Stock taken without using the Remove action</li>
            <li>Delivery received without using the Add action</li>
            <li>Count done after unlogged changes</li>
            <li>System quantity overridden with Set Qty</li>
          </ul>
        </div>
        <p className="text-xs text-gray-500">Use the <strong className="text-white">Missing</strong> or <strong className="text-white">Excess</strong> stat cards to filter to each type. Resolve by doing a fresh Count or logging the missed Remove/Add.</p>
      </div>
    ),
  },
  {
    title: 'Bulk Actions',
    icon: <Tag size={18} />,
    content: (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">Select multiple items using the checkboxes to perform batch operations.</p>
        {[
          { label: 'Set Status', desc: 'Update the status of all selected items at once.' },
          { label: 'Physical Count', desc: 'Opens a per-item list with individual +/− steppers. Each item defaults to its last physical count. Great for doing a full location count.' },
          { label: 'Export', desc: 'Downloads selected items to an Excel file.' },
          { label: 'Delete', desc: 'Permanently removes all selected items.' },
        ].map(({ label, desc }) => (
          <div key={label} className="flex gap-3">
            <CheckCircle2 size={14} className="text-violet-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-sm font-semibold text-white">{label} </span>
              <span className="text-xs text-gray-400">{desc}</span>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-500 mt-2">Tip: Use the search bar and then <em>"Select all N"</em> to quickly select everything matching your search.</p>
      </div>
    ),
  },
  {
    title: 'Import & Export',
    icon: <Upload size={18} />,
    content: (
      <div className="space-y-4">
        <p className="text-sm text-gray-300">Import CSV or Excel files. After uploading, map your column names to the fields — it remembers common matches automatically.</p>
        <p className="text-sm font-semibold text-white">Three import modes:</p>
        {[
          { label: 'General', desc: 'Full upsert — updates all fields for existing stock numbers, inserts new ones.' },
          { label: 'Stock Count', desc: 'Only updates physical_quantity for existing items. System qty is preserved. Good for uploading a count sheet without touching the record.' },
          { label: 'Stock Release', desc: 'Sets status to Removed and records who received it. Good for uploading a release manifest.' },
        ].map(({ label, desc }) => (
          <div key={label} className="flex gap-3">
            <Download size={14} className="text-violet-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-sm font-semibold text-white">{label} </span>
              <span className="text-xs text-gray-400">{desc}</span>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-500 mt-1">Export All (header) or Export (bulk action) gives you a full Excel sheet including all fields, location, and mismatch status.</p>
        <div className="flex gap-3 items-start bg-white/4 border border-white/8 rounded-xl px-4 py-3">
          <ClipboardList size={14} className="text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-white">Count Sheet</p>
            <p className="text-xs text-gray-400 mt-0.5">Generates a printable Excel or CSV with a blank "Physical Count" column. Filter by location, rack, or category first to produce a sheet for a specific area. Fill it in during a stocktake, then import it back as a Stock Count.</p>
          </div>
        </div>
      </div>
    ),
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TutorialModal({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const current = steps[step];

  return (
    <Dialog open={open} onClose={onClose} title="How to use Babes Stock" size="lg">
      <div className="flex flex-col gap-4">
        {/* Step pills */}
        <div className="flex gap-1.5 flex-wrap">
          {steps.map((s, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={cn(
                'text-[10px] px-2.5 py-1 rounded-full border transition-colors',
                i === step
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-white/4 border-white/8 text-gray-500 hover:text-gray-300 hover:bg-white/8'
              )}
            >
              {s.title}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white/3 border border-white/8 rounded-xl px-4 py-4 min-h-[200px]">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-violet-400">{current.icon}</span>
            <h3 className="text-base font-semibold text-white">{current.title}</h3>
            <span className="ml-auto text-xs text-gray-600">{step + 1} / {steps.length}</span>
          </div>
          {current.content}
        </div>

        {/* Navigation */}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft size={14} /> Prev
          </Button>
          <div className="flex-1 flex items-center justify-center gap-1">
            {steps.map((_, i) => (
              <button key={i} onClick={() => setStep(i)} className={cn('w-1.5 h-1.5 rounded-full transition-colors', i === step ? 'bg-violet-400' : 'bg-white/20')} />
            ))}
          </div>
          {step < steps.length - 1
            ? <Button variant="ghost" size="sm" onClick={() => setStep(s => s + 1)}>Next <ChevronRight size={14} /></Button>
            : <Button size="sm" onClick={onClose}>Done <CheckCircle2 size={14} /></Button>
          }
        </div>
      </div>
    </Dialog>
  );
}
