'use client';
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from './ui/toast';
import type { StockItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Minus, Plus, Hash, ClipboardList, X, AlertTriangle, ArrowRightLeft } from 'lucide-react';

type AdjustType = 'subtract' | 'add' | 'count' | 'set_system' | 'move';

interface Props {
  item: StockItem | null;
  onClose: () => void;
  onSaved: () => void;
  onMismatchResolved?: () => void;
  locations?: string[];
}

const TYPES: { value: AdjustType; label: string; icon: React.ReactNode; activeColor: string; activeBg: string }[] = [
  { value: 'subtract', label: 'Remove',    icon: <Minus size={15} />,        activeColor: 'text-red-400',     activeBg: 'border-red-500/40 bg-red-500/10' },
  { value: 'add',      label: 'Add',       icon: <Plus size={15} />,         activeColor: 'text-emerald-400', activeBg: 'border-emerald-500/40 bg-emerald-500/10' },
  { value: 'count',    label: 'Count',     icon: <ClipboardList size={15} />, activeColor: 'text-amber-400',  activeBg: 'border-amber-500/40 bg-amber-500/10' },
  { value: 'set_system', label: 'Set Qty', icon: <Hash size={15} />,         activeColor: 'text-blue-400',   activeBg: 'border-blue-500/40 bg-blue-500/10' },
];

function defaultAmount(type: AdjustType, item: StockItem): string {
  if (type === 'count') return String(item.physical_quantity ?? item.quantity);
  if (type === 'set_system') return String(item.quantity);
  return '1';
}

export function QuickAdjust({ item, onClose, onSaved, onMismatchResolved, locations }: Props) {
  const { success, error: toastError } = useToast();
  const [type, setType] = useState<AdjustType>('subtract');
  const [amount, setAmount] = useState('1');
  const [takenBy, setTakenBy] = useState('');
  const [broughtBy, setBroughtBy] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmNegative, setConfirmNegative] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [transferQty, setTransferQty] = useState(1);

  useEffect(() => {
    if (item) {
      setType('subtract');
      setAmount('1');
      setTakenBy('');
      setBroughtBy('');
      setNotes('');
      setNewLocation('');
      setTransferQty(item.quantity ?? 1);
    }
  }, [item?.id]);

  const handleTypeChange = (t: AdjustType) => {
    setType(t);
    setConfirmNegative(false);
    setTakenBy('');
    setBroughtBy('');
    setNewLocation('');
    if (t === 'move' && item) setTransferQty(item.quantity ?? 1);
    if (item && t !== 'move') setAmount(defaultAmount(t, item));
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

  // Detect whether this operation would resolve a quantity mismatch
  const willResolveMismatch =
    item.quantity_mismatch &&
    ((type === 'count' && num === item.quantity) ||
     (type === 'set_system' && item.physical_quantity !== null && num === item.physical_quantity));

  const submit = async () => {
    setSaving(true);
    try {
      let res: Response;
      if (type === 'move') {
        const body = item.location
          ? { location: newLocation, qty: transferQty }
          : { location: newLocation || null };
        res = await fetch(`/api/stock/${item.id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/stock/${item.id}/adjust`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            amount: num,
            taken_by: takenBy || undefined,
            brought_by: broughtBy || undefined,
            notes: notes || undefined,
          }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      success('Updated', `${item.name}`);
      onSaved();
      onClose();
      if (willResolveMismatch) onMismatchResolved?.();
    } catch (e) {
      toastError('Failed', String(e));
    } finally {
      setSaving(false);
    }
  };

  const activeType = TYPES.find(t => t.value === type)!;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'fixed z-50 bg-gray-900 border-white/10 shadow-2xl overflow-y-auto',
          'bottom-0 left-0 right-0 border-t rounded-t-2xl max-h-[92dvh]',
          'sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
          'sm:w-full sm:max-w-md sm:border sm:rounded-2xl sm:max-h-[90dvh]',
          'animate-in slide-in-from-bottom-2 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200'
        )}
      >
        {/* Drag handle — mobile only */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <div className="px-5 pb-6 pt-2 sm:pt-5 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 font-mono">{item.stock_number}</p>
              <h3 className="text-base font-semibold text-white">{item.name}</h3>
              <div className="flex items-center gap-3 mt-0.5">
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
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/8">
              <X size={16} />
            </button>
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-2">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => handleTypeChange(t.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 border transition-all',
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

          {/* Move Location — separate action */}
          <button
            type="button"
            onClick={() => handleTypeChange('move' as AdjustType)}
            className={cn(
              'flex items-center justify-center gap-2 w-full rounded-xl px-3 py-2.5 border transition-all text-sm',
              type === 'move'
                ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-400'
                : 'border-white/8 bg-white/3 hover:bg-white/6 text-gray-400'
            )}
          >
            <ArrowRightLeft size={14} />
            <span className="font-medium">{item.location ? 'Move to Different Location' : 'Set Location'}</span>
          </button>

          {/* Taken by — only for Remove */}
          {type === 'subtract' && (
            <div>
              <label className="text-xs font-medium text-red-400 mb-1.5 block">Taken by *</label>
              <Input
                value={takenBy}
                onChange={(e) => setTakenBy(e.target.value)}
                placeholder="Who is taking this stock?"
                style={{ fontSize: '16px' }}
              />
            </div>
          )}

          {/* Brought by — only for Add */}
          {type === 'add' && (
            <div>
              <label className="text-xs font-medium text-emerald-400 mb-1.5 block">Brought by</label>
              <Input
                value={broughtBy}
                onChange={(e) => setBroughtBy(e.target.value)}
                placeholder="Who is bringing this stock? (optional)"
                style={{ fontSize: '16px' }}
              />
            </div>
          )}

          {type === 'move' && (
            <div className="space-y-3">
              {item.location ? (
                <>
                  <div className="rounded-lg bg-indigo-500/8 border border-indigo-500/20 px-3 py-2">
                    <p className="text-xs text-indigo-300">
                      Transferring from <strong>{item.location}</strong> · {item.quantity} unit{item.quantity !== 1 ? 's' : ''} available
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-indigo-400 block mb-1.5">Units to transfer</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setTransferQty(q => Math.max(1, q - 1))}
                        className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold shrink-0"
                      >−</button>
                      <input
                        type="number"
                        min={1}
                        max={item.quantity}
                        value={transferQty}
                        onChange={(e) => setTransferQty(Math.max(1, Math.min(item.quantity, parseInt(e.target.value) || 1)))}
                        style={{ fontSize: '24px' }}
                        className="flex-1 text-center font-bold bg-white/5 border border-white/10 rounded-xl py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                      <button
                        type="button"
                        onClick={() => setTransferQty(q => Math.min(item.quantity, q + 1))}
                        className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold shrink-0"
                      >+</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTransferQty(item.quantity)}
                      className="mt-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >Transfer all {item.quantity}</button>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-indigo-400 block mb-1.5">Transfer to location</label>
                    <input
                      type="text"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      placeholder="Type or tap a suggestion…"
                      style={{ fontSize: '16px' }}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-colors"
                    />
                    {(() => {
                      const suggestions = (locations ?? []).filter(l =>
                        l !== item.location &&
                        l.toLowerCase().includes(newLocation.toLowerCase().trim())
                      );
                      return suggestions.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pt-1.5">
                          {suggestions.map(loc => (
                            <button key={loc} type="button" onClick={() => setNewLocation(loc)}
                              className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 active:bg-indigo-500/30 transition-colors">
                              {loc}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2">
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300">This item has no location set. Select an existing location or type a new one.</p>
                  </div>
                  <label className="text-xs font-medium text-indigo-400 block">Set location</label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="e.g. Warehouse A"
                    style={{ fontSize: '16px' }}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-colors"
                  />
                  {(() => {
                    const suggestions = (locations ?? []).filter(l =>
                      l.toLowerCase().includes(newLocation.toLowerCase().trim())
                    );
                    return suggestions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {suggestions.map(loc => (
                          <button key={loc} type="button" onClick={() => setNewLocation(loc)}
                            className="text-xs px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 active:bg-indigo-500/30 transition-colors">
                            {loc}
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
          )}

          {/* Amount stepper */}
          {type !== 'move' && (
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">
                {type === 'count' ? 'Physical count' : type === 'set_system' ? 'Set system quantity to' : 'Quantity'}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAmount(String(Math.max(0, num - 1)))}
                  className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold shrink-0"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={{ fontSize: '24px' }}
                  className="flex-1 text-center font-bold bg-white/5 border border-white/10 rounded-xl py-2 text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                />
                <button
                  type="button"
                  onClick={() => setAmount(String(num + 1))}
                  className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center text-gray-300 hover:bg-white/15 active:scale-95 transition-all text-xl font-bold shrink-0"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {type !== 'move' && (
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
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">Notes (optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason…"
              style={{ fontSize: '16px' }}
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
              disabled={saving || (type === 'subtract' && !takenBy.trim()) || (type === 'move' && (!newLocation.trim() || newLocation.trim() === item.location || (!!item.location && (transferQty < 1 || transferQty > item.quantity))))}
            >
              {saving ? 'Saving…' : type === 'move' ? (item.location ? `Transfer ${transferQty} unit${transferQty !== 1 ? 's' : ''}` : 'Set Location') : `Confirm ${activeType.label}`}
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
