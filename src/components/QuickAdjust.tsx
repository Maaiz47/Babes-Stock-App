'use client';
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { StockItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Plus, Minus, Hash, ClipboardList, X } from 'lucide-react';

type AdjustType = 'add' | 'subtract' | 'set_system' | 'count';

interface Props {
  item: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: { value: AdjustType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'add', label: 'Add Stock', icon: <Plus size={14} />, color: 'text-emerald-400' },
  { value: 'subtract', label: 'Remove Stock', icon: <Minus size={14} />, color: 'text-red-400' },
  { value: 'set_system', label: 'Set System Qty', icon: <Hash size={14} />, color: 'text-blue-400' },
  { value: 'count', label: 'Physical Count', icon: <ClipboardList size={14} />, color: 'text-amber-400' },
];

export function QuickAdjust({ item, onClose, onSaved }: Props) {
  const { success, error: toastError } = useToast();
  const [type, setType] = useState<AdjustType>('add');
  const [amount, setAmount] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setType('add');
      setAmount('1');
      setNotes('');
    }
  }, [item?.id]);

  if (!item) return null;

  const numAmount = Math.max(0, parseInt(amount) || 0);

  const preview = () => {
    if (type === 'add') return item.quantity + numAmount;
    if (type === 'subtract') return Math.max(0, item.quantity - numAmount);
    if (type === 'set_system') return numAmount;
    return item.physical_quantity ?? item.quantity; // count doesn't change system qty
  };

  const submit = async () => {
    if (numAmount < 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/stock/${item.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, amount: numAmount, notes: notes || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      success('Updated', `${item.name} quantity adjusted`);
      onSaved();
      onClose();
    } catch (e) {
      toastError('Failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-white/10 rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-6 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between pt-1">
            <div>
              <p className="text-xs text-gray-500 font-mono">{item.stock_number}</p>
              <h3 className="text-base font-semibold text-white">{item.name}</h3>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-sm text-gray-400">System: <strong className="text-white">{item.quantity}</strong></span>
                {item.physical_quantity != null && (
                  <span className={cn('text-sm', item.quantity_mismatch ? 'text-amber-400' : 'text-gray-400')}>
                    Physical: <strong>{item.physical_quantity}</strong>
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/8">
              <X size={16} />
            </button>
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center border transition-all',
                  type === t.value
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-white/8 bg-white/3 hover:bg-white/6'
                )}
              >
                <span className={cn(type === t.value ? t.color : 'text-gray-500')}>{t.icon}</span>
                <span className={cn('text-[10px] leading-tight font-medium', type === t.value ? 'text-white' : 'text-gray-500')}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          {/* Amount input with +/- */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">
              {type === 'count' ? 'Physical Count' : type === 'set_system' ? 'Set system quantity to' : 'Amount'}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAmount(String(Math.max(0, numAmount - 1)))}
                className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-lg font-bold"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 text-center text-2xl font-bold bg-white/5 border border-white/10 rounded-xl py-2 text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
              <button
                onClick={() => setAmount(String(numAmount + 1))}
                className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-lg font-bold"
              >
                +
              </button>
            </div>

            {/* Preview */}
            {type !== 'count' && (
              <p className="text-xs text-center mt-2 text-gray-500">
                System qty: <strong className="text-white">{item.quantity}</strong>
                {' → '}
                <strong className={cn(
                  type === 'add' ? 'text-emerald-400' : type === 'subtract' ? 'text-red-400' : 'text-blue-400'
                )}>{preview()}</strong>
              </p>
            )}
            {type === 'count' && (
              <p className={cn('text-xs text-center mt-2', numAmount !== item.quantity ? 'text-amber-400' : 'text-emerald-400')}>
                Physical count: <strong>{numAmount}</strong>
                {numAmount !== item.quantity && ` — mismatch vs system (${item.quantity})`}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">Notes (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for adjustment…"
            />
          </div>

          <Button className="w-full" size="lg" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </>
  );
}
