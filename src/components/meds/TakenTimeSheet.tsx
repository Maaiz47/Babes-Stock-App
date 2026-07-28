'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledDose } from '@/lib/meds';
import { formatInstantHHMM, medColor } from './MedChecklist';

/**
 * Confirms WHEN a dose was actually swallowed, rather than assuming it was the
 * moment she got round to tapping the tick.
 *
 * This is not bookkeeping. The next dose's reminder is spaced from this value,
 * so recording 10:30 for a tablet taken at 08:15 would push the following dose
 * two hours further out than it should be — and recording 08:15 for one taken
 * at 10:30 would have her take the next one dangerously soon after it.
 *
 * The common case stays one extra tap: "Just now" is preselected, so confirming
 * is a single press on a large target.
 */

const QUICK_OFFSETS: { label: string; minutesAgo: number }[] = [
  { label: 'Just now', minutesAgo: 0 },
  { label: '5 min ago', minutesAgo: 5 },
  { label: '15 min ago', minutesAgo: 15 },
  { label: '30 min ago', minutesAgo: 30 },
  { label: '1 hour ago', minutesAgo: 60 },
  { label: '2 hours ago', minutesAgo: 120 },
];

export interface TakenTimeSheetProps {
  dose: ScheduledDose;
  tzOffsetMinutes: number;
  /** Scheduled instant of the next dose of this same medicine, if there is one. */
  nextDoseAt: string | null;
  /** Minimum spacing this medicine wants between doses. */
  minGapMinutes: number;
  saving: boolean;
  onConfirm: (takenAtISO: string) => void;
  onCancel: () => void;
}

/** HH:MM in her timezone for a given instant. */
function toLocalHHMM(ms: number, tzOffsetMinutes: number): string {
  return new Date(ms + tzOffsetMinutes * 60_000).toISOString().slice(11, 16);
}

export function TakenTimeSheet({
  dose,
  tzOffsetMinutes,
  nextDoseAt,
  minGapMinutes,
  saving,
  onConfirm,
  onCancel,
}: TakenTimeSheetProps) {
  // Frozen at open. A ticking "now" would make the chips drift under her thumb
  // and could turn a confirmed time into a future one between tap and submit.
  const [openedAt] = useState(() => Date.now());
  const [minutesAgo, setMinutesAgo] = useState<number | null>(0);
  const [customHHMM, setCustomHHMM] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /**
   * The instant she is confirming.
   *
   * A custom HH:MM is read in HER timezone, not the device's — everything else
   * on this screen is, and the two differ the moment she travels. It is anchored
   * to the dose's own local day, then rolled back 24h if that lands in the
   * future, which is what makes "I took the 20:00 dose at 00:30" work.
   */
  const takenMs = useMemo(() => {
    if (minutesAgo !== null) return openedAt - minutesAgo * 60_000;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(customHHMM)) return null;

    const doseLocalDay = new Date(Date.parse(dose.scheduled_at) + tzOffsetMinutes * 60_000)
      .toISOString()
      .slice(0, 10);
    const [h, m] = customHHMM.split(':').map(Number);
    const [y, mo, d] = doseLocalDay.split('-').map(Number);
    let ms = Date.UTC(y, mo - 1, d, h, m) - tzOffsetMinutes * 60_000;
    if (ms > openedAt) ms -= 86_400_000;
    return ms;
  }, [minutesAgo, customHHMM, openedAt, dose.scheduled_at, tzOffsetMinutes]);

  const color = medColor(dose.color);
  const scheduledMs = Date.parse(dose.scheduled_at);

  const lateBy = takenMs !== null ? Math.round((takenMs - scheduledMs) / 60_000) : 0;

  /**
   * What this answer does to the next dose. Shown BEFORE she commits, because a
   * reminder quietly moving an hour later is exactly the kind of thing that
   * feels broken when it is unexplained.
   */
  const nextDosePreview = useMemo(() => {
    if (takenMs === null || !nextDoseAt) return null;
    const nextScheduled = Date.parse(nextDoseAt);
    if (Number.isNaN(nextScheduled)) return null;
    const earliest = takenMs + minGapMinutes * 60_000;
    if (earliest <= nextScheduled) return null;
    return {
      from: toLocalHHMM(nextScheduled, tzOffsetMinutes),
      to: toLocalHHMM(earliest, tzOffsetMinutes),
    };
  }, [takenMs, nextDoseAt, minGapMinutes, tzOffsetMinutes]);

  const invalid = takenMs === null;

  return (
    <>
      {/* Solid scrim — backdrop-filter on a fixed full-screen layer crashes iOS WebKit. */}
      <button
        type="button"
        aria-label="Cancel"
        className="fixed inset-0 z-[60] cursor-default bg-black/80"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Confirm when you took ${dose.name}`}
        className={cn(
          'safe-b fixed bottom-0 left-0 right-0 z-[70] max-h-[92dvh] overflow-y-auto',
          'rounded-t-2xl border-t border-white/10 bg-gray-900 shadow-2xl',
          'sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2',
          'sm:rounded-2xl sm:border',
          'animate-in slide-in-from-bottom-2 sm:zoom-in-95 duration-200'
        )}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        <div className="space-y-4 px-5 pb-6 pt-2 sm:pt-5">
          <div className="flex items-start gap-3">
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', color.dot)} />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">{dose.name}</h2>
              <p className="text-xs text-gray-500">
                {dose.strength ? `${dose.strength} · ` : ''}
                {dose.dose_label} · due {dose.time}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-300">When did you take it?</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_OFFSETS.map((q) => {
                const active = minutesAgo === q.minutesAgo;
                return (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      setMinutesAgo(q.minutesAgo);
                      setCustomHHMM('');
                    }}
                    className={cn(
                      'rounded-full border px-3 py-2 text-sm transition-colors',
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/10 bg-white/5 text-gray-300 active:bg-white/10'
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="taken-exact-time"
              className="mb-1.5 block text-xs font-medium text-gray-400"
            >
              Or an exact time
            </label>
            <div className="relative flex items-center">
              <Clock size={14} className="pointer-events-none absolute left-3 z-10 text-gray-500" />
              <input
                id="taken-exact-time"
                type="time"
                value={customHHMM}
                onChange={(e) => {
                  setCustomHHMM(e.target.value);
                  setMinutesAgo(e.target.value ? null : 0);
                }}
                style={{ fontSize: '16px' }}
                className={cn(
                  'w-full rounded-lg border bg-white/5 py-2 pl-9 pr-3 text-gray-100',
                  'transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50',
                  '[color-scheme:dark]',
                  minutesAgo === null && customHHMM
                    ? 'border-emerald-500/50'
                    : 'border-white/10'
                )}
              />
            </div>
          </div>

          {takenMs !== null && (
            <div className="space-y-1.5 rounded-xl border border-white/8 bg-white/4 px-4 py-3">
              <p className="text-sm text-gray-300">
                Recording as taken at{' '}
                <strong className="font-mono text-white">
                  {toLocalHHMM(takenMs, tzOffsetMinutes)}
                </strong>
                {lateBy >= 5 && (
                  <span className="text-amber-400">
                    {' '}
                    — {lateBy < 60 ? `${lateBy} min` : `${Math.floor(lateBy / 60)} h ${lateBy % 60} min`} after it was due
                  </span>
                )}
              </p>
              {nextDosePreview && (
                <p className="border-t border-white/8 pt-1.5 text-xs text-indigo-300">
                  Next dose moves from {nextDosePreview.from} to{' '}
                  <strong>{nextDosePreview.to}</strong>, to keep them far enough apart.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-gray-300 transition-colors active:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={invalid || saving}
              onClick={() => takenMs !== null && onConfirm(new Date(takenMs).toISOString())}
              className={cn(
                'flex flex-[2] items-center justify-center gap-2 rounded-xl py-3',
                'text-sm font-semibold text-white transition-all active:scale-[0.98]',
                'bg-emerald-600 disabled:opacity-50',
                !invalid && !saving && 'shadow-lg shadow-emerald-600/25'
              )}
            >
              <Check size={17} strokeWidth={3} />
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Re-exported so callers can render the same HH:MM the sheet does. */
export { formatInstantHHMM };
