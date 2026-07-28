'use client';

import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DoseRingProps {
  /** Doses ticked off on the selected day. */
  taken: number;
  /** Doses expected on the selected day. */
  expected: number;
  /** Doses explicitly skipped on the selected day. */
  skipped?: number;
  /** Rolling 7-day adherence percent from the API (null while loading). */
  adherencePercent?: number | null;
  /** Expected dose count behind the adherence percent, for the caption. */
  adherenceExpected?: number;
  className?: string;
}

const SIZE = 132;
const STROKE = 11;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DoseRing({
  taken,
  expected,
  skipped = 0,
  adherencePercent = null,
  adherenceExpected = 0,
  className,
}: DoseRingProps) {
  // React 19 useId() contains characters that are unsafe inside url(#…), so strip them.
  const gradientId = `dose-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const total = Math.max(0, expected);
  const done = Math.min(Math.max(0, taken), total);
  const ratio = total === 0 ? 0 : done / total;
  const offset = CIRCUMFERENCE * (1 - ratio);
  const remaining = Math.max(0, total - done - Math.min(skipped, total - done));
  const allDone = total > 0 && done >= total;

  const adherence = adherencePercent == null ? null : Math.max(0, Math.min(100, adherencePercent));

  return (
    <section
      className={cn(
        'rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:p-5',
        'flex items-center gap-4 sm:gap-6',
        className
      )}
      aria-label="Today's dose progress"
    >
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={allDone ? '#34d399' : '#a78bfa'} />
              <stop offset="100%" stopColor={allDone ? '#10b981' : '#f472b6'} />
            </linearGradient>
          </defs>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
          />
          {total > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          )}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {allDone ? (
            <>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                <Check size={20} strokeWidth={3} />
              </span>
              <span className="mt-1.5 text-[11px] font-medium tracking-wide text-emerald-400">
                All done
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-3xl font-semibold leading-none text-white tabular-nums">
                {done}
              </span>
              <span className="mt-1 font-mono text-xs text-gray-500 tabular-nums">of {total}</span>
              <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gray-600">
                doses
              </span>
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Today</p>
          <p className="mt-0.5 text-sm text-gray-300">
            {total === 0
              ? 'No doses scheduled'
              : allDone
                ? 'Every dose ticked off'
                : `${remaining} still to take`}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Stat label="Taken" value={done} tone="emerald" />
          {skipped > 0 && <Stat label="Skipped" value={skipped} tone="gray" />}
          {remaining > 0 && <Stat label="Left" value={remaining} tone="violet" />}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
              7-day adherence
            </span>
            <span className="font-mono text-sm font-semibold text-white tabular-nums">
              {adherence == null ? '—' : `${adherence}%`}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className={cn(
                'h-full rounded-full',
                adherence != null && adherence >= 80
                  ? 'bg-emerald-500'
                  : adherence != null && adherence >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
              )}
              style={{
                width: `${adherence ?? 0}%`,
                transition: 'width 700ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>
          {adherenceExpected > 0 && (
            <p className="mt-1 font-mono text-[10px] text-gray-600 tabular-nums">
              over {adherenceExpected} due doses
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'violet' | 'gray' }) {
  const tones = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    violet: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
    gray: 'bg-white/5 text-gray-400 border-white/10',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
        tones[tone]
      )}
    >
      <span className="font-mono tabular-nums">{value}</span>
      {label}
    </span>
  );
}
