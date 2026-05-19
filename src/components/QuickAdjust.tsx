'use client';
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { StockItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Minus, Plus, Hash, ClipboardList, X, AlertTriangle } from 'lucide-react';

type AdjustType = 'subtract' | 'add' | 'count' | 'set_system';

interface Props {
  item: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: { value: AdjustType; label: string; icon: React.ReactNode; activeColor: string; activeBg: string }[] = [
  { value: 'subtract', label: 'Remove',      icon: <Minus size={15} />,       activeColor: 'text-red-400',    activeBg: 'border-red-500/40 bg-red-500/10' },
  { value: 'add',      label: 'Add',         icon: <Plus size={15} />,        activeColor: 'text-emerald-400', activeBg: 'border-emerald-500/40 bg-emerald-500/10' },
  { value: 'count',    label: 'Count',       icon: <ClipboardList size={15}/>, activeColor: 'text-amber-400',  activeBg: 'border-amber-500/40 bg-amber-500/10' },
  { value: 'set_system', label: 'Set Qty',   icon: <Hash size={15} />,        activeColor: 'text-blue-400',   activeBg: 'border-blue-500/40 bg-blue-500/10' },
];

function defaultAmount(type: AdjustType, item: StockItem): string {
  if (type === 'count') return String(item.physical_quantity ?? item.quantity);
  if (type === 'set_system') return String(item.quantity);
  return '1';
}

export function QuickAdjust({ item, onClose, onSaved }: Props) {
  const { success, error: toastError } = useToast();
  const [type, setType] = useState<AdjustType>('subtract');
  const [amount, setAmount] = useState('1');
  const [takenBy, setTakenBy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmNegative, setConfirmNegative] = useState(false);

  useEffect(() => {
    if (item) {
      setType('subtract');
      setAmount('1');
      setTakenBy('');
      setNotes('');
    }
  }, [item?.id]);

  const handleTypeChange = (t: AdjustType) => {
    setType(t);
    setConfirmNegative(false);
    if (item) setAmount(defaultAmount(t, item));
  };

  if (!item) return null;

  const num = Math.max(0, parseInt(amount) || 0);

  const newSystemQty = type === 'add'
    ? item.quantity + num
    : type === 'subtract'
    ? item.quantity - num
    : type === 'set_system'
    ? num
    : item.quantity;

  const newPhysical = type === 'add'
    ? (item.physical_quantity ?? item.quantity) + num
    : type === 'subtract'
    ? Math.max(0, (item.physical_quantity ?? item.quantity) - num)
    : type === 'count'
    ? num
    : item.physical_quantity;

  const systemChanged = newSystemQty !== item.quantity;
  const physicalMismatch = newPhysical != null && newPhysical !== newSystemQty;
  const wouldGoNegative = type === 'subtract' && newSystemQty < 0;

  const submit = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/stock/${item.id}/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amount: num,
          taken_by: takenBy || undefined,
          notes: notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      success('Updated', `${item.name}`);
      onSaved();
      onClose();
    } catch (e) {
      toastError('Failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  const activeType = TYPES.find(t => t.value === type)!;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-white/10 rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom-2 duration-200 max-h-[92dvh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-8 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between pt-1">
            <div>
              <p className="text-xs text-gray-500 font-mono">{item.stock_number}</p>
              <h3 className="text-base font-semibold text-white">{item.name}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm">
                  <span className="text-gray-500">System </span>
                  <strong className="text-white">{item.quantity}</strong>
                </span>
                {item.physical_quantity != null && (
                  <span className={cn('text-sm flex items-center gap-1', item.quantity_mismatch ? 'text-amber-400' : 'text-gray-400')}>
                    {item.quantity_mismatch && <AlertTriangle size={11} />}
                    <span className="text-gray-500">Physical </span>
                    <strong>{item.physical_quantity}</strong>
                  </span>
                )}
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/8">
              <X size={16} />
            </button>
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => handleTypeChange(t.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 border transition-all',
                  type === t.value ? t.activeBg : 'border-white/8 bg-white/3 hover:bg-white/6'
                )}
              >
                <span className={type === t.value ? t.activeColor : 'text-gray-500'}>{t.icon}</span>
                <span className={cn('text-[10px] font-semibold leading-tight', type === t.value ? 'text-white' : 'text-gray-500')}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          {/* Taken by — only for Remove */}
          {type === 'subtract' && (
            <div>
              <label className="text-xs font-medium text-red-400 mb-1.5 block">Taken by *</label>
              <Input
                value={takenBy}
                onChange={(e) => setTakenBy(e.target.value)}
                placeholder="Who is taking this stock?"
                autoFocus
              />
            </div>
          )}

          {/* Amount stepper */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">
              {type === 'count' ? 'Physical count' : type === 'set_system' ? 'Set system quantity to' : 'Quantity'}
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAmount(String(Math.max(0, num - 1)))}
                className="w-12 h-12 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 text-center text-3xl font-bold bg-white/5 border border-white/10 rounded-xl py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              />
              <button
                onClick={() => setAmount(String(num + 1))}
                className="w-12 h-12 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Preview — always show, flag heavily if system changes */}
          <div className={cn(
            'rounded-xl px-4 py-3 space-y-1.5 border',
            systemChanged ? 'bg-red-500/8 border-red-500/20' : 'bg-white/4 border-white/8'
          )}>
            {type !== 'count' && (
              <div className="flex items-center justify-between text-sm">
                <span className={cn('font-medium', systemChanged ? 'text-red-300' : 'text-gray-400')}>
                  {systemChanged && <AlertTriangle size={12} className="inline mr-1" />}
                  System qty
                </span>
                <span>
                  <span className="text-gray-500">{item.quantity}</span>
                  <span className="text-gray-600 mx-1.5">→</span>
                  <strong className={cn(
                    type === 'add' ? 'text-emerald-400' :
                    type === 'subtract' ? 'text-red-400' :
                    'text-blue-400'
                  )}>{newSystemQty}</strong>
                </span>
              </div>
            )}
            {newPhysical != null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Physical qty</span>
                <span>
                  <span className="text-gray-500">{item.physical_quantity ?? '—'}</span>
                  <span className="text-gray-600 mx-1.5">→</span>
                  <strong className={physicalMismatch ? 'text-amber-400' : 'text-emerald-400'}>{newPhysical}</strong>
                </span>
              </div>
            )}
            {newSystemQty < 0 && (
              <p className="text-xs text-red-400 flex items-center gap-1 pt-0.5 border-t border-white/8">
                <AlertTriangle size={11} /> System qty goes negative — item will be flagged as mismatch
              </p>
            )}
            {physicalMismatch && newSystemQty >= 0 && (
              <p className="text-xs text-amber-400 flex items-center gap-1 pt-0.5 border-t border-white/8">
                <AlertTriangle size={11} /> Physical and system will not match — flagged as mismatch
              </p>
            )}
            {type === 'set_system' && (
              <p className="text-xs text-blue-300 flex items-center gap-1 pt-0.5 border-t border-white/8">
                <AlertTriangle size={11} /> Direct system quantity override — use with care
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">Notes (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason…"
            />
          </div>

          {wouldGoNegative && !confirmNegative && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 space-y-3">
              <p className="text-sm text-red-300 font-medium flex items-center gap-2">
                <AlertTriangle size={15} />
                Stock will go to {newSystemQty} — below zero
              </p>
              <p className="text-xs text-gray-400">This flags a mismatch and records the removal, but the system quantity will be negative. Only proceed if the stock was actually taken.</p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="flex-1" onClick={() => setConfirmNegative(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" size="sm" className="flex-1" onClick={() => setConfirmNegative(true)}>
                  Yes, proceed
                </Button>
              </div>
            </div>
          )}
          {(!wouldGoNegative || confirmNegative) && (
            <Button
              className="w-full"
              size="lg"
              variant={type === 'subtract' ? 'destructive' : type === 'add' ? 'success' : 'default'}
              onClick={wouldGoNegative && !confirmNegative ? () => setConfirmNegative(false) : submit}
              disabled={saving || (type === 'subtract' && !takenBy.trim())}
            >
              {saving ? 'Saving…' : `Confirm ${activeType.label}`}
            </Button>
          )}
          {type === 'subtract' && !takenBy.trim() && (
            <p className="text-xs text-center text-red-400 -mt-2">Enter who is taking the stock to continue</p>
          )}
        </div>
      </div>
    </>
  );
}
