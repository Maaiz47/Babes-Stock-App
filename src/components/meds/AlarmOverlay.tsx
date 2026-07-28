'use client';

import { useEffect, useRef } from 'react';
import { Check, Clock, Pill, Utensils, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FOOD_LABELS, type DoseStatus, type ScheduledDose } from '@/lib/meds';
import { formatOverdue, medColor } from './MedChecklist';

export interface AlarmOverlayProps {
  dose: ScheduledDose;
  /** Ticking epoch-ms clock. */
  now: number;
  snoozeMinutes: number;
  busy?: boolean;
  onAction: (dose: ScheduledDose, status: DoseStatus, snoozeMinutes?: number) => void;
  /** Silences the alarm and closes the overlay without logging anything. */
  onDismiss: () => void;
}

export function AlarmOverlay({
  dose,
  now,
  snoozeMinutes,
  busy = false,
  onAction,
  onDismiss,
}: AlarmOverlayProps) {
  const haloRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);

  // Keyframes live here via the Web Animations API — this feature does not own globals.css.
  useEffect(() => {
    const animations: Animation[] = [];

    const halo = haloRef.current;
    if (halo && typeof halo.animate === 'function') {
      animations.push(
        halo.animate(
          [
            { transform: 'scale(0.85)', opacity: 0.5 },
            { transform: 'scale(1.6)', opacity: 0 },
          ],
          { duration: 1900, iterations: Infinity, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' }
        )
      );
    }

    const icon = iconRef.current;
    if (icon && typeof icon.animate === 'function') {
      animations.push(
        icon.animate(
          [
            { transform: 'scale(1) rotate(-6deg)' },
            { transform: 'scale(1.08) rotate(6deg)' },
            { transform: 'scale(1) rotate(-6deg)' },
          ],
          { duration: 1900, iterations: Infinity, easing: 'ease-in-out' }
        )
      );
    }

    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, []);

  // Keep the page behind the overlay from scrolling while the alarm is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const color = medColor(dose.color);
  const scheduledMs = Date.parse(dose.scheduled_at);
  const overdueMinutes = Number.isNaN(scheduledMs)
    ? 0
    : Math.max(0, Math.floor((now - scheduledMs) / 60_000));

  return (
    // Solid background on purpose: backdrop-filter on a fixed full-screen layer crashes iOS WebKit.
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Time to take ${dose.name}`}
      className="fixed inset-0 z-[300] overflow-y-auto bg-[#0b0b16]/98"
    >
      <div
        className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pt-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Silence alarm"
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-300"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <span
              ref={haloRef}
              aria-hidden="true"
              className={cn('absolute inset-0 rounded-full', color.dot)}
            />
            <span
              className={cn(
                'relative flex h-24 w-24 items-center justify-center rounded-full border',
                color.soft
              )}
            >
              <span ref={iconRef} className="inline-flex">
                <Pill size={40} className={color.text} />
              </span>
            </span>
          </div>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-400">
            {overdueMinutes < 1 ? 'Time for your medicine' : formatOverdue(overdueMinutes)}
          </p>

          <h1 className="mt-3 text-balance text-4xl font-bold leading-tight tracking-tight text-white">
            {dose.name}
          </h1>

          {dose.strength && (
            <p className="mt-2 font-mono text-lg text-gray-400 tabular-nums">{dose.strength}</p>
          )}

          <p className="mt-4 text-xl font-semibold text-white">{dose.dose_label}</p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300">
              <Clock size={12} />
              Scheduled {dose.time}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
              <Utensils size={12} />
              {FOOD_LABELS[dose.food_instruction]}
            </span>
          </div>

          {dose.notes && (
            <p className="mt-5 max-w-sm text-pretty text-sm leading-relaxed text-gray-400">
              {dose.notes}
            </p>
          )}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(dose, 'taken')}
            className={cn(
              'flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 text-xl font-bold tracking-wide text-white',
              'shadow-lg shadow-emerald-900/40 transition-all active:scale-[0.98] hover:bg-emerald-500',
              'focus:outline-none focus:ring-2 focus:ring-emerald-400/60',
              busy && 'pointer-events-none opacity-60'
            )}
            style={{ minHeight: 72 }}
          >
            <Check size={26} strokeWidth={3} />
            TAKEN
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(dose, 'pending', snoozeMinutes)}
            className={cn(
              'flex w-full items-center justify-center gap-2.5 rounded-2xl border border-white/12 bg-white/8 px-6 text-lg font-semibold text-gray-100',
              'transition-all active:scale-[0.98] hover:bg-white/12',
              'focus:outline-none focus:ring-2 focus:ring-white/30',
              busy && 'pointer-events-none opacity-60'
            )}
            style={{ minHeight: 60 }}
          >
            <Clock size={20} />
            Snooze {snoozeMinutes} min
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(dose, 'skipped')}
            className="w-full py-3 text-sm font-medium text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-60"
          >
            Skip this dose
          </button>

          <p className="pt-1 text-center text-[11px] leading-relaxed text-gray-600">
            Reminders only — always follow your prescription and your doctor&apos;s advice.
          </p>
        </div>
      </div>
    </div>
  );
}
