'use client';

import { useState } from 'react';
import { Check, Clock, MoreHorizontal, Moon, Sun, Sunset, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FOOD_LABELS,
  courseEndDate,
  type DoseStatus,
  type FoodInstruction,
  type Medication,
  type ScheduledDose,
} from '@/lib/meds';

/* -------------------------------------------------------------------------
 * Shared tokens for the /meds screens.
 *
 * These live here (rather than in a lib file) because this feature owns only
 * its own component files — MedicineEditor, AlarmOverlay and the page import
 * them from this module. MedChecklist imports nothing from its siblings, so
 * there is no cycle.
 * ---------------------------------------------------------------------- */

export const MED_COLOR_TOKENS = [
  'violet',
  'emerald',
  'amber',
  'rose',
  'sky',
  'teal',
  'orange',
] as const;

export type MedColorToken = (typeof MED_COLOR_TOKENS)[number];

interface MedColorStyle {
  dot: string;
  text: string;
  soft: string;
  ring: string;
}

/** Literal class strings — Tailwind cannot see dynamically built class names. */
export const MED_COLORS: Record<MedColorToken, MedColorStyle> = {
  violet: {
    dot: 'bg-violet-400',
    text: 'text-violet-300',
    soft: 'bg-violet-500/10 border-violet-500/25',
    ring: 'ring-violet-400/40',
  },
  emerald: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    soft: 'bg-emerald-500/10 border-emerald-500/25',
    ring: 'ring-emerald-400/40',
  },
  amber: {
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    soft: 'bg-amber-500/10 border-amber-500/25',
    ring: 'ring-amber-400/40',
  },
  rose: {
    dot: 'bg-rose-400',
    text: 'text-rose-300',
    soft: 'bg-rose-500/10 border-rose-500/25',
    ring: 'ring-rose-400/40',
  },
  sky: {
    dot: 'bg-sky-400',
    text: 'text-sky-300',
    soft: 'bg-sky-500/10 border-sky-500/25',
    ring: 'ring-sky-400/40',
  },
  teal: {
    dot: 'bg-teal-400',
    text: 'text-teal-300',
    soft: 'bg-teal-500/10 border-teal-500/25',
    ring: 'ring-teal-400/40',
  },
  orange: {
    dot: 'bg-orange-400',
    text: 'text-orange-300',
    soft: 'bg-orange-500/10 border-orange-500/25',
    ring: 'ring-orange-400/40',
  },
};

export function medColor(token: string): MedColorStyle {
  return MED_COLORS[token as MedColorToken] ?? MED_COLORS.violet;
}

const FOOD_CHIP: Record<FoodInstruction, string> = {
  before_food: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  with_food: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  after_food: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  any: 'bg-white/5 text-gray-400 border-white/10',
};

/** A well-formed local date, i.e. exactly "YYYY-MM-DD". */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD as UTC so the device timezone can never shift the day. */
function parseDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/**
 * Formatters take whatever the API gave them, so they must survive a malformed
 * date. `toLocaleDateString` on an Invalid Date does not throw, it returns the
 * literal string "Invalid Date" — which is worse than useless on a reminder
 * screen, so a bad value renders as an em dash instead.
 */
function formatDay(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—';
  const day = parseDay(dateStr);
  if (Number.isNaN(day.getTime())) return '—';
  return day.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
}

/** "2 Aug" */
export function formatMedDate(dateStr: string): string {
  return formatDay(dateStr, { day: 'numeric', month: 'short' });
}

/** "Mon 28 Jul 2026" */
export function formatMedDateLong(dateStr: string): string {
  return formatDay(dateStr, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "Mon" */
export function formatWeekdayShort(dateStr: string): string {
  return formatDay(dateStr, { weekday: 'short' });
}

/**
 * courseEndDate() derives its answer from `med.start_date` via addDays(), which
 * ends in `new Date(...).toISOString()`. A malformed start_date makes that throw
 * RangeError: Invalid time value — during render, which unmounts the whole
 * medicines list and white-screens the reminder.
 *
 * The data layer is fixing the root cause; this is the render path refusing to
 * be the thing that takes the screen down. An end date we cannot trust simply
 * means no "Course ends" chip, and every other detail of the dose still shows.
 */
export function safeCourseEndDate(med: Medication): string | null {
  let end: string | null;
  try {
    end = courseEndDate(med);
  } catch {
    return null;
  }
  return end && ISO_DATE_RE.test(end) ? end : null;
}

/** Render a UTC instant as HH:MM in the user's configured timezone. */
export function formatInstantHHMM(iso: string, tzOffsetMinutes: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--:--';
  return new Date(t + tzOffsetMinutes * 60_000).toISOString().slice(11, 16);
}

export function formatOverdue(minutes: number): string {
  if (minutes < 1) return 'due now';
  if (minutes < 60) return `${minutes} min overdue`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours} h ${mins} min overdue` : `${hours} h overdue`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} overdue`;
}

/* ---------------------------------------------------------------- slots */

type SlotKey = 'morning' | 'afternoon' | 'evening';

const SLOTS: { key: SlotKey; label: string; icon: typeof Sun; accent: string }[] = [
  { key: 'morning', label: 'Morning', icon: Sun, accent: 'text-amber-400' },
  { key: 'afternoon', label: 'Afternoon', icon: Sunset, accent: 'text-orange-400' },
  { key: 'evening', label: 'Evening & night', icon: Moon, accent: 'text-indigo-400' },
];

export function slotOf(time: string): SlotKey {
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour) || hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/* ---------------------------------------------------------------- props */

/**
 * Extra intent carried alongside a dose write.
 *
 * `force` means "she tapped this, in the app, just now". It is the only thing
 * allowed to move a dose out of a settled status ('taken' / 'skipped'); without
 * it the API answers 409 and writes nothing. Every action in this file is such
 * a tap, so every one of them sets it — otherwise a mis-tapped tick could never
 * be undone, and an accidental "taken" would silence every reminder for a dose
 * she has not actually swallowed.
 *
 * The service worker's notification buttons deliberately never set it: a
 * lock-screen reminder can outlive the dose it names by hours.
 */
export interface DoseActionOptions {
  force?: boolean;
}

export type DoseActionHandler = (
  dose: ScheduledDose,
  status: DoseStatus,
  snoozeMinutes?: number,
  options?: DoseActionOptions
) => void;

export interface MedChecklistProps {
  doses: ScheduledDose[];
  medications: Medication[];
  tzOffsetMinutes: number;
  /** Ticking epoch-ms clock, so overdue labels stay fresh. */
  now: number;
  /** Dose key currently being written to the server. */
  busyKey: string | null;
  snoozeMinutes: number;
  onAction: DoseActionHandler;
}

export function MedChecklist({
  doses,
  medications,
  tzOffsetMinutes,
  now,
  busyKey,
  snoozeMinutes,
  onAction,
}: MedChecklistProps) {
  // The open menu closes on outside click and after every action, so it needs no effect.
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const endDates = new Map<string, string | null>();
  for (const med of medications) endDates.set(med.id, safeCourseEndDate(med));

  if (doses.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center">
        <Clock size={22} className="mx-auto text-gray-600" />
        <p className="mt-3 text-sm font-medium text-gray-300">No doses on this day</p>
        <p className="mt-1 text-xs text-gray-500">
          Either no course was running, or every course had already finished.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SLOTS.map((slot) => {
        const inSlot = doses.filter((d) => slotOf(d.time) === slot.key);
        if (inSlot.length === 0) return null;

        const times = Array.from(new Set(inSlot.map((d) => d.time))).sort();
        const SlotIcon = slot.icon;
        const takenInSlot = inSlot.filter((d) => d.status === 'taken').length;

        return (
          <section key={slot.key}>
            <div className="mb-2.5 flex items-center gap-2">
              <SlotIcon size={14} className={slot.accent} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                {slot.label}
              </h3>
              <span className="font-mono text-[11px] text-gray-600 tabular-nums">
                {takenInSlot}/{inSlot.length}
              </span>
              <span className="h-px flex-1 bg-white/8" />
            </div>

            <div className="space-y-4">
              {times.map((time) => (
                <div key={time}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-semibold leading-none tracking-tight text-white tabular-nums">
                      {time}
                    </span>
                    <span className="text-[11px] text-gray-600">
                      {inSlot.filter((d) => d.time === time).length} to take
                    </span>
                  </div>

                  <div className="space-y-2">
                    {inSlot
                      .filter((d) => d.time === time)
                      .map((dose) => (
                        <DoseRow
                          key={dose.key}
                          dose={dose}
                          courseEnd={endDates.get(dose.medication_id) ?? null}
                          tzOffsetMinutes={tzOffsetMinutes}
                          now={now}
                          busy={busyKey === dose.key}
                          snoozeMinutes={snoozeMinutes}
                          menuOpen={openMenu === dose.key}
                          onToggleMenu={() =>
                            setOpenMenu((k) => (k === dose.key ? null : dose.key))
                          }
                          onCloseMenu={() => setOpenMenu(null)}
                          onAction={onAction}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- row */

interface DoseRowProps {
  dose: ScheduledDose;
  courseEnd: string | null;
  tzOffsetMinutes: number;
  now: number;
  busy: boolean;
  snoozeMinutes: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onAction: DoseActionHandler;
}

function DoseRow({
  dose,
  courseEnd,
  tzOffsetMinutes,
  now,
  busy,
  snoozeMinutes,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onAction,
}: DoseRowProps) {
  const color = medColor(dose.color);
  const scheduledMs = Date.parse(dose.scheduled_at);
  const overdueMinutes = Number.isNaN(scheduledMs)
    ? 0
    : Math.floor((now - scheduledMs) / 60_000);

  const taken = dose.status === 'taken';
  const skipped = dose.status === 'skipped';
  const pending = dose.status === 'pending';
  const overdue = pending && overdueMinutes >= 0;
  const upcoming = pending && overdueMinutes < 0;

  const snoozedUntilMs = dose.snoozed_until ? Date.parse(dose.snoozed_until) : 0;
  const snoozed = pending && snoozedUntilMs > now;

  return (
    <div className="relative">
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border p-3 transition-colors',
          taken && 'border-emerald-500/25 bg-emerald-500/[0.06]',
          skipped && 'border-white/8 bg-white/[0.02] opacity-60',
          upcoming && 'border-white/8 bg-white/[0.02]',
          overdue && !snoozed && 'border-white/8 border-l-2 border-l-rose-500 bg-rose-500/[0.05]',
          overdue && snoozed && 'border-white/8 bg-white/[0.03]'
        )}
      >
        <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
          {overdue && !snoozed && (
            <span
              className={cn('absolute inline-flex h-full w-full rounded-full opacity-70 animate-pulse', color.dot)}
              style={{ transform: 'scale(1.9)' }}
              aria-hidden="true"
            />
          )}
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', color.dot)} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                'text-sm font-semibold',
                taken ? 'text-gray-400 line-through' : skipped ? 'text-gray-500' : 'text-white'
              )}
            >
              {dose.name}
            </span>
            {dose.strength && (
              <span className="font-mono text-[11px] text-gray-500 tabular-nums">
                {dose.strength}
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip className="border-white/10 bg-white/5 text-gray-300">{dose.dose_label}</Chip>
            <Chip className={FOOD_CHIP[dose.food_instruction]}>
              <Utensils size={10} />
              {FOOD_LABELS[dose.food_instruction]}
            </Chip>
            {courseEnd && (
              <Chip className="border-white/10 bg-white/5 text-gray-500">
                Course ends {formatMedDate(courseEnd)}
              </Chip>
            )}
          </div>

          <p
            className={cn(
              'mt-1.5 text-[11px] font-medium',
              taken && 'text-emerald-400',
              skipped && 'text-gray-500',
              upcoming && 'text-gray-600',
              overdue && !snoozed && 'text-rose-400',
              overdue && snoozed && 'text-amber-400'
            )}
          >
            {/* Both settled states say how to get back out of them. A tick she
                did not mean to make is only harmless while it is obvious that
                it can be taken back. */}
            {taken && (
              <>
                {dose.taken_at
                  ? `Taken ${formatInstantHHMM(dose.taken_at, tzOffsetMinutes)}`
                  : 'Taken'}
                <span className="font-normal text-gray-500"> · tap the tick to undo</span>
              </>
            )}
            {skipped && (
              <>
                Skipped
                <span className="font-normal text-gray-500"> · undo in the menu</span>
              </>
            )}
            {upcoming && `Due at ${dose.time}`}
            {overdue &&
              !snoozed &&
              (overdueMinutes < 1 ? 'Due now' : formatOverdue(overdueMinutes))}
            {overdue &&
              snoozed &&
              `Snoozed until ${formatInstantHHMM(new Date(snoozedUntilMs).toISOString(), tzOffsetMinutes)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleMenu}
            aria-label={`More options for ${dose.name}`}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-300"
          >
            <MoreHorizontal size={16} />
          </button>

          {/* One tap ticks it off, one tap puts it back — no dialog either way.
              `force` is what makes the second tap work: undoing a mis-tap has to
              be as easy as making it, or an accidental tick becomes a missed
              antibiotic with every reminder channel switched off. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(dose, taken ? 'pending' : 'taken', undefined, { force: true })}
            aria-label={taken ? `Mark ${dose.name} as not taken` : `Mark ${dose.name} as taken`}
            aria-pressed={taken}
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-all',
              'focus:outline-none focus:ring-2 focus:ring-violet-500/50',
              taken
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-white/15 bg-white/5 text-transparent hover:border-white/30 hover:bg-white/10 active:scale-95',
              busy && 'pointer-events-none opacity-50'
            )}
          >
            <Check size={20} strokeWidth={3} className={taken ? '' : 'text-white/25'} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[40] cursor-default"
            onClick={onCloseMenu}
          />
          <div className="absolute right-0 top-full z-[50] mt-1 w-48 overflow-hidden rounded-xl border border-white/10 bg-gray-900 shadow-2xl shadow-black/60">
            {/* Snooze means "remind me later", never "override what I recorded".
                It writes `pending`, which is not a settled status, so a guarded
                write already succeeds on a genuinely pending dose — `force` would
                buy nothing here and would only unlock reverting a dose she has
                already taken, wiping taken_at and re-alarming her to take it
                again. Hidden outright on a settled row: there is nothing to
                remind her about once the dose is recorded. */}
            {!taken && !skipped && (
              <MenuItem
                onClick={() => {
                  onCloseMenu();
                  onAction(dose, 'pending', snoozeMinutes);
                }}
              >
                <Clock size={14} className="text-amber-400" />
                Snooze {snoozeMinutes} min
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                onCloseMenu();
                onAction(dose, skipped ? 'pending' : 'skipped', undefined, { force: true });
              }}
            >
              <span className="h-3.5 w-3.5 rounded-full border-2 border-gray-500" />
              {skipped ? 'Un-skip this dose' : 'Skip this dose'}
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
        className
      )}
    >
      {children}
    </span>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-gray-200 transition-colors hover:bg-white/8"
    >
      {children}
    </button>
  );
}
