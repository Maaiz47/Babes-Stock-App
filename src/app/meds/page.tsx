'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Pill,
  Plus,
  RotateCcw,
  Stethoscope,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { canAccessMeds } from '@/lib/meds-access';
import {
  FREQUENCY_LABELS,
  MALDIVES_OFFSET_MIN,
  addDays,
  computeDosesForDate,
  daysBetween,
  tzNow,
  type Appointment,
  type DoseStatus,
  type Medication,
  type MedSettings,
  type ScheduledDose,
} from '@/lib/meds';
import { useMedAlarm } from '@/hooks/useMedAlarm';
import {
  ISO_DATE_RE,
  MedChecklist,
  formatMedDate,
  formatMedDateLong,
  formatWeekdayShort,
  medColor,
  safeCourseEndDate,
  type DoseActionOptions,
} from '@/components/meds/MedChecklist';
import { DoseRing } from '@/components/meds/DoseRing';
import { MedicineEditor } from '@/components/meds/MedicineEditor';
import { MedSettingsPanel } from '@/components/meds/MedSettingsPanel';
import { AlarmOverlay } from '@/components/meds/AlarmOverlay';

interface SessionUser {
  userId: string;
  username: string;
  email: string;
  isAdmin: boolean;
}

interface Adherence {
  expected: number;
  taken: number;
  skipped: number;
  percent: number;
}

interface DayView {
  date: string;
  settings: MedSettings;
  doses: ScheduledDose[];
  medications: Medication[];
  adherence: Adherence;
  /**
   * Optional on purpose. Appointments come from `med_appointments` behind the
   * 403-gated API — they used to be a hard-coded constant in @/lib/meds, which
   * shipped clinical detail into a public JS chunk. A deploy that predates the
   * table simply omits the key, and that must render an empty card, not throw.
   */
  appointments?: Appointment[];
}

type TabKey = 'today' | 'schedule' | 'medicines' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'medicines', label: 'Medicines' },
  { key: 'settings', label: 'Settings' },
];

const DISCLAIMER = "Reminders only — always follow your prescription and your doctor's advice.";

/** Monday of the week containing `dateStr`. */
function startOfWeek(dateStr: string): string {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, -((day + 6) % 7));
}

export default function MedsPage() {
  const router = useRouter();
  const toast = useToast();

  const [authState, setAuthState] = useState<'loading' | 'ok' | 'denied'>('loading');
  /**
   * The day she deliberately opened, or null while the view simply tracks the
   * current day.
   *
   * The viewed day is DERIVED from this and the clock (see `date` below) rather
   * than stored. Storing it and hoping something keeps it in step with the clock
   * is precisely the bug this replaces: at local midnight the stored day and the
   * real day silently diverged, `isToday` went false, and `alarmDoses` latched
   * to [] — so with the app left open at her bedside the 07:00 and 08:00 doses
   * never rang and never notified, while the screen still showed yesterday's
   * fully-ticked checklist. Derivation makes that state unrepresentable.
   */
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('today');
  const [data, setData] = useState<DayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Medication | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Medication | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [weekAnchor, setWeekAnchor] = useState('');
  const [enablingAlarms, setEnablingAlarms] = useState(false);

  const seededRef = useRef(false);
  const dateRef = useRef('');
  const toastRef = useRef(toast);
  /** Her tz offset, mirrored so the navigation callbacks can stay stable. */
  const tzOffsetRef = useRef(MALDIVES_OFFSET_MIN);

  // ------------------------------------------------------------------ the day
  // Declared before the effects below because the data fetch keys off `date`.
  const settings = data?.settings ?? null;
  const tzOffset = settings?.tz_offset_minutes ?? MALDIVES_OFFSET_MIN;

  /** The current day in her timezone. '' until the clock is read on the client. */
  const today = useMemo(() => (now ? tzNow(tzOffset).date : ''), [now, tzOffset]);

  /**
   * The day on screen. While nothing is pinned this IS today, recomputed from
   * the same 30s ticker that drives `today` — so the local midnight rollover
   * moves the view, the fetch and the alarm engine forward on its own, with no
   * tap needed. A pinned day is left exactly where she put it.
   */
  const date = pinnedDate ?? today;
  const isToday = Boolean(date) && date === today;

  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  useEffect(() => {
    tzOffsetRef.current = tzOffset;
  }, [tzOffset]);
  useEffect(() => {
    toastRef.current = toast;
  });

  /**
   * Every way of changing the visible day goes through here, so "am I still on
   * today?" is decided in exactly one place. It reads the clock fresh rather
   * than using `today`, which lags by up to one 30s tick and would otherwise
   * mis-classify a tap made in the first seconds after midnight. Landing back on
   * the current day un-pins, resuming the follow-the-clock behaviour.
   */
  const goToDate = useCallback((day: string) => {
    if (!day) return;
    setPinnedDate(day === tzNow(tzOffsetRef.current).date ? null : day);
  }, []);

  // Resolve "today" on the client only — avoids any server/client render mismatch.
  // Until this runs, `now` is 0, so `today` and the derived `date` are both ''
  // on the server render and on the first client render alike.
  useEffect(() => {
    setWeekAnchor(tzNow(MALDIVES_OFFSET_MIN).date);
    setNow(Date.now());
  }, []);

  // Keep overdue labels honest.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ------------------------------------------------------------------ auth
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        const user = json?.user as SessionUser | null | undefined;
        if (!user) {
          router.replace('/login');
          return;
        }
        setAuthState(canAccessMeds(user) ? 'ok' : 'denied');
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ------------------------------------------------------------------ data
  const fetchDay = useCallback(async (day: string): Promise<DayView> => {
    const res = await fetch(`/api/meds?date=${encodeURIComponent(day)}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json?.error ?? `Could not load medicines (${res.status})`));
    return json as DayView;
  }, []);

  const load = useCallback(
    async (day: string, opts: { silent?: boolean } = {}) => {
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      try {
        let view = await fetchDay(day);
        // First ever visit: preload the prescription, once.
        if (view.medications.length === 0 && !seededRef.current) {
          seededRef.current = true;
          const res = await fetch('/api/meds/seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (res.ok) view = await fetchDay(day);
        }
        setData(view);
        setLoadError('');
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchDay]
  );

  useEffect(() => {
    if (authState !== 'ok' || !date) return;
    load(date);
  }, [authState, date, load]);

  const refresh = useCallback(() => load(dateRef.current, { silent: true }), [load]);

  /**
   * Retry a failed load on its own.
   *
   * Nothing else re-triggers the fetch until the day changes again, so a load
   * that failed during the midnight rollover would leave the screen — and the
   * alarm engine — on yesterday's doses for the whole of the new day, with only
   * a "Try again" button to save her. The interval exists only while there is an
   * error and is torn down the moment one succeeds.
   */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (authState !== 'ok' || !loadError) return;
    const id = setInterval(() => {
      if (dateRef.current) loadRef.current(dateRef.current, { silent: true });
    }, 30_000);
    return () => clearInterval(id);
  }, [authState, loadError]);

  // ------------------------------------------------------------------ derived
  const medications = useMemo(() => data?.medications ?? [], [data]);
  const doses = useMemo(() => data?.doses ?? [], [data]);
  const snoozeMinutes = settings?.snooze_min ?? 10;

  /**
   * From the DB, behind the 403 gate — never hard-coded here. Missing key means
   * a deploy older than the `med_appointments` table: render nothing, not a
   * crash. Rows with an unusable date are dropped rather than formatted into
   * "Invalid Date" / "NaN days ago".
   */
  const appointments = useMemo(() => {
    const raw = data?.appointments;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((a): a is Appointment => Boolean(a) && ISO_DATE_RE.test(String(a?.date)))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const takenToday = doses.filter((d) => d.status === 'taken').length;
  const skippedToday = doses.filter((d) => d.status === 'skipped').length;

  // ------------------------------------------------------------------ actions
  /**
   * Write one dose action.
   *
   * `options.force` is how an explicit tap in the app says "yes, I really mean
   * to change a dose I already settled". Without it the API refuses to move a
   * dose out of 'taken' or 'skipped' and writes nothing (409) — which is right
   * for a notification button that may have been sitting on the lock screen for
   * hours, and wrong for her thumb on the tick circle. The override actions —
   * the tick toggle and Skip — set it; Snooze does not, and the service worker
   * never does. Undoing a mis-tap has to work first time, or an accidental tick
   * silences every reminder for a dose she has not taken.
   *
   * The options type is the checklist's on purpose: this one function is what
   * both the checklist and useMedAlarm call, so if either contract moves, this
   * stops compiling rather than quietly dropping the flag.
   */
  const handleDoseAction = useCallback(
    async (
      dose: ScheduledDose,
      status: DoseStatus,
      snoozeMin?: number,
      options?: DoseActionOptions
    ) => {
      const force = options?.force === true;
      const previousStatus = dose.status;
      setBusyKey(dose.key);
      setData((prev) =>
        prev
          ? {
              ...prev,
              doses: prev.doses.map((d) =>
                d.key === dose.key
                  ? {
                      ...d,
                      status,
                      taken_at: status === 'taken' ? new Date().toISOString() : null,
                      snoozed_until: snoozeMin
                        ? new Date(Date.now() + snoozeMin * 60_000).toISOString()
                        : null,
                    }
                  : d
              ),
            }
          : prev
      );

      try {
        const res = await fetch('/api/meds/dose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            medication_id: dose.medication_id,
            scheduled_at: dose.scheduled_at,
            status,
            ...(snoozeMin ? { snooze_minutes: snoozeMin } : {}),
            ...(force ? { force: true } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? 'Could not save that dose'));
        if (snoozeMin) {
          toastRef.current.info('Snoozed', `Reminding you again in ${snoozeMin} minutes.`);
        } else if (status === 'pending' && previousStatus !== 'pending') {
          // Say out loud what an undo did. She is most likely here because the
          // tick was an accident, and "it is back on your list" is the only
          // thing that tells her the reminders are on again.
          toastRef.current.info(
            previousStatus === 'taken' ? 'Un-ticked' : 'Un-skipped',
            `${dose.name} is back on your list for ${dose.time}.`
          );
        }
      } catch (e) {
        toastRef.current.error(
          'Dose not saved',
          e instanceof Error ? e.message : 'Something went wrong'
        );
      } finally {
        setBusyKey(null);
        await load(dateRef.current, { silent: true });
      }
    },
    [load]
  );

  // ------------------------------------------------------------------ alarms
  /**
   * Only the current day may ring, so browsing history never sets the phone off.
   * The rollover effect keeps `date` on the real today, so this no longer latches
   * to [] at midnight. During the one refetch that follows a rollover this still
   * holds yesterday's doses for a moment; that is safe, because useMedAlarm's own
   * isRingable() re-checks each dose's day against the live clock.
   */
  const alarmDoses = useMemo(() => (isToday ? doses : []), [isToday, doses]);
  const alarm = useMedAlarm({ doses: alarmDoses, settings, onAction: handleDoseAction });
  const { state: alarmState, enableAlarms, testAlarm, stopRinging, dismissActive } = alarm;

  const runEnableAlarms = useCallback(async () => {
    setEnablingAlarms(true);
    try {
      await enableAlarms();
    } catch (e) {
      toastRef.current.error(
        'Could not turn on alarms',
        e instanceof Error ? e.message : 'Something went wrong'
      );
    } finally {
      setEnablingAlarms(false);
    }
  }, [enableAlarms]);

  const alarmsNeedSetup =
    alarmState.supported && (alarmState.permission !== 'granted' || !alarmState.audioUnlocked);

  /**
   * The full-screen alarm's buttons. She is looking straight at the dose, so
   * Taken and Skip are explicit overrides and carry `force`.
   *
   * Snooze deliberately does not. It only ever means "remind me later", and the
   * overlay can outlive the truth: the page does not poll the day view, so a
   * dose settled on another device leaves this overlay up on stale data. Without
   * `force` a snooze against an already-settled dose is refused by the API
   * instead of reverting it and re-alarming her for medicine already taken.
   */
  const handleAlarmAction = useCallback(
    async (dose: ScheduledDose, status: DoseStatus, snoozeMin?: number) => {
      stopRinging();
      dismissActive();
      const isSnooze = snoozeMin != null;
      await handleDoseAction(dose, status, snoozeMin, isSnooze ? undefined : { force: true });
    },
    [handleDoseAction, stopRinging, dismissActive]
  );

  const dismissAlarm = useCallback(() => {
    stopRinging();
    dismissActive();
  }, [stopRinging, dismissActive]);

  // ------------------------------------------------------------------ medicines
  const deleteMedicine = async () => {
    if (!pendingDelete) return;
    setMutating(true);
    try {
      const res = await fetch(`/api/meds/medications/${pendingDelete.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not delete the medicine'));
      toast.success('Medicine deleted', pendingDelete.name);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      toast.error('Delete failed', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setMutating(false);
    }
  };

  const resetToDefaults = async () => {
    setMutating(true);
    try {
      const res = await fetch('/api/meds/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? 'Could not reset the list'));
      toast.success('Prescription restored', 'The original medicines are back.');
      setResetOpen(false);
      await refresh();
    } catch (e) {
      toast.error('Reset failed', e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setMutating(false);
    }
  };

  const nextSortOrder = medications.reduce((max, m) => Math.max(max, m.sort_order), 0) + 1;

  // ------------------------------------------------------------------ render
  if (authState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080810]">
        <Loader2 size={22} className="animate-spin text-gray-600" />
      </div>
    );
  }

  if (authState === 'denied') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080810] px-5">
        <div className="w-full max-w-sm rounded-2xl border border-white/8 bg-white/[0.03] p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
            <Pill size={22} className="text-gray-500" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white">
            You don&apos;t have access to this section
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            This area is private. If you think you should be able to see it, ask an admin.
          </p>
          <Button className="mt-5 w-full" onClick={() => router.push('/')}>
            Back to Stock
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080810]">
      <header className="safe-t safe-x sticky top-0 z-30 border-b border-white/8 bg-[#080810]/80 backdrop-blur-xl">
        <div className="mx-auto max-w-lg px-4 pt-3 sm:px-6 sm:pt-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/')}
              aria-label="Back"
              className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-300"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg shadow-rose-500/30">
              <Pill size={15} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold leading-tight text-white">Medicines</h1>
              <p className="truncate text-[11px] text-gray-500">
                {date ? formatMedDateLong(date) : '—'}
              </p>
            </div>
            {refreshing && <Loader2 size={14} className="animate-spin text-gray-600" />}
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => date && goToDate(addDays(date, -1))}
              disabled={!date}
              aria-label="Previous day"
              className="flex h-8 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            {/* Un-pins rather than navigating to `today`, which lags by up to one
                30s tick — routing it through goToDate would pin yesterday when
                tapped in the first seconds after midnight. */}
            <button
              type="button"
              onClick={() => setPinnedDate(null)}
              className="flex-1 rounded-lg py-1.5 text-center text-xs font-medium text-gray-200 transition-colors hover:bg-white/8"
            >
              {isToday ? 'Today' : date ? formatMedDate(date) : '—'}
              {!isToday && date && (
                <span className="ml-1.5 text-[10px] text-violet-400">Back to today</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => date && goToDate(addDays(date, 1))}
              disabled={!date || !today || date >= today}
              aria-label="Next day"
              className="flex h-8 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-white disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1 pb-3">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === t.key
                    ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="safe-x mx-auto max-w-lg space-y-5 px-4 py-5 sm:px-6">
        {loadError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red-200">Could not load your medicines</p>
              <p className="mt-0.5 break-words text-xs text-red-300/80">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => date && load(date)}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-3">
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
            <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
            <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        ) : (
          <>
            {tab === 'today' && (
              <>
                {alarmsNeedSetup && (
                  <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.09] p-4">
                    <div className="flex items-start gap-3">
                      <BellRing size={16} className="mt-0.5 shrink-0 text-amber-400" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-white">
                          Turn on alarms for this device
                        </h2>
                        <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                          Your iPhone will not ring or show a reminder until you tap this once, on
                          this device.
                        </p>
                        <Button
                          variant="warning"
                          className="mt-3"
                          onClick={runEnableAlarms}
                          disabled={enablingAlarms}
                        >
                          {enablingAlarms && <Loader2 size={14} className="animate-spin" />}
                          Turn on alarms
                        </Button>
                      </div>
                    </div>
                  </section>
                )}

                <DoseRing
                  taken={takenToday}
                  expected={doses.length}
                  skipped={skippedToday}
                  adherencePercent={data?.adherence?.percent ?? null}
                  adherenceExpected={data?.adherence?.expected ?? 0}
                />

                {!isToday && date && (
                  <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-center text-[11px] text-gray-400">
                    Looking back at {formatMedDateLong(date)} — you can still tick doses you took.
                  </p>
                )}

                <MedChecklist
                  doses={doses}
                  medications={medications}
                  tzOffsetMinutes={tzOffset}
                  now={now}
                  busyKey={busyKey}
                  snoozeMinutes={snoozeMinutes}
                  onAction={handleDoseAction}
                />

                <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                    <Stethoscope size={13} className="text-sky-400" />
                    Appointments
                  </h2>

                  {appointments.length === 0 ? (
                    <p className="mt-3 text-xs leading-relaxed text-gray-500">
                      No appointments saved yet.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {appointments.map((appointment) => {
                        const away = today ? daysBetween(today, appointment.date) : null;
                        const past = Boolean(today) && appointment.date < today;
                        return (
                          <li
                            key={appointment.id}
                            className={cn('flex items-start gap-3', past && 'opacity-50')}
                          >
                            <div className="w-14 shrink-0 rounded-lg border border-white/10 bg-white/5 px-1.5 py-1 text-center">
                              <div className="font-mono text-sm font-semibold leading-none text-white tabular-nums">
                                {appointment.date.slice(8, 10)}
                              </div>
                              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-gray-500">
                                {formatMedDate(appointment.date).split(' ')[1]}
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  'text-sm font-medium',
                                  past ? 'text-gray-400' : 'text-gray-200'
                                )}
                              >
                                {appointment.label}
                              </p>
                              {appointment.detail && (
                                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
                                  {appointment.detail}
                                </p>
                              )}
                              {away != null && Number.isFinite(away) && (
                                <p
                                  className={cn(
                                    'mt-1 text-[11px] font-medium',
                                    past ? 'text-gray-500' : 'text-sky-400'
                                  )}
                                >
                                  {away === 0
                                    ? 'Today'
                                    : away === 1
                                      ? 'Tomorrow'
                                      : away > 1
                                        ? `In ${away} days`
                                        : `${-away} day${away === -1 ? '' : 's'} ago`}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}

            {tab === 'schedule' && (
              <ScheduleTab
                medications={medications}
                tzOffset={tzOffset}
                today={today}
                selected={date}
                weekAnchor={weekAnchor || date}
                onWeekAnchorChange={setWeekAnchor}
                onPickDay={(day) => {
                  goToDate(day);
                  setTab('today');
                }}
              />
            )}

            {tab === 'medicines' && (
              <>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      setEditing(null);
                      setEditorOpen(true);
                    }}
                  >
                    <Plus size={15} />
                    Add medicine
                  </Button>
                  <Button variant="outline" onClick={() => setResetOpen(true)}>
                    <RotateCcw size={14} />
                    Reset
                  </Button>
                </div>

                {medications.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center">
                    <Pill size={22} className="mx-auto text-gray-600" />
                    <p className="mt-3 text-sm font-medium text-gray-300">No medicines yet</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Add one, or restore the original prescription with Reset.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {medications.map((med) => (
                      <MedicineCard
                        key={med.id}
                        medication={med}
                        onEdit={() => {
                          setEditing(med);
                          setEditorOpen(true);
                        }}
                        onDelete={() => setPendingDelete(med)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'settings' && (
              <MedSettingsPanel
                settings={settings}
                onSettingsChange={(next) =>
                  setData((prev) => (prev ? { ...prev, settings: next } : prev))
                }
                onTestAlarm={testAlarm}
                onEnableAlarms={enableAlarms}
                permission={alarmState.permission}
                pushEnabled={alarmState.pushEnabled}
                audioUnlocked={alarmState.audioUnlocked}
                supported={alarmState.supported}
              />
            )}
          </>
        )}

        <footer className="border-t border-white/8 pt-4 pb-2">
          <p className="text-center text-[11px] leading-relaxed text-gray-600">{DISCLAIMER}</p>
        </footer>
      </main>

      {/* Keyed + conditionally mounted so each open starts from a fresh form. */}
      {editorOpen && (
        <MedicineEditor
          key={editing?.id ?? 'new'}
          open
          onClose={() => setEditorOpen(false)}
          medication={editing}
          defaultStartDate={today || date}
          nextSortOrder={nextSortOrder}
          onSaved={refresh}
        />
      )}

      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => (mutating ? undefined : setPendingDelete(null))}
        title="Delete this medicine?"
        description="Its reminders and tick history will be removed too. This cannot be undone."
      >
        <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200">
          {pendingDelete?.name}
          {pendingDelete?.strength ? ` · ${pendingDelete.strength}` : ''}
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setPendingDelete(null)}
            disabled={mutating}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            onClick={deleteMedicine}
            disabled={mutating}
          >
            {mutating && <Loader2 size={14} className="animate-spin" />}
            Delete
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={resetOpen}
        onClose={() => (mutating ? undefined : setResetOpen(false))}
        title="Reset to prescription defaults?"
        description="Every medicine you added or edited is replaced by the original prescription list."
      >
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
          Your current medicines and their tick history will be deleted. Only do this if the list
          has drifted from the printed prescription.
        </p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => setResetOpen(false)}
            disabled={mutating}
          >
            Cancel
          </Button>
          <Button variant="warning" className="flex-1" onClick={resetToDefaults} disabled={mutating}>
            {mutating && <Loader2 size={14} className="animate-spin" />}
            Reset list
          </Button>
        </div>
      </Dialog>

      {alarmState.ringing && alarmState.activeDose && (
        <AlarmOverlay
          dose={alarmState.activeDose}
          now={now}
          snoozeMinutes={snoozeMinutes}
          busy={busyKey === alarmState.activeDose.key}
          onAction={handleAlarmAction}
          onDismiss={dismissAlarm}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- schedule */

function ScheduleTab({
  medications,
  tzOffset,
  today,
  selected,
  weekAnchor,
  onWeekAnchorChange,
  onPickDay,
}: {
  medications: Medication[];
  tzOffset: number;
  today: string;
  selected: string;
  weekAnchor: string;
  onWeekAnchorChange: (day: string) => void;
  onPickDay: (day: string) => void;
}) {
  const weekStart = weekAnchor ? startOfWeek(weekAnchor) : '';

  const days = useMemo(() => {
    if (!weekStart) return [];
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const dayDoses = computeDosesForDate(medications, day, tzOffset);
      const byTime = new Map<string, number>();
      for (const dose of dayDoses) byTime.set(dose.time, (byTime.get(dose.time) ?? 0) + 1);
      return {
        day,
        total: dayDoses.length,
        times: Array.from(byTime.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      };
    });
  }, [weekStart, medications, tzOffset]);

  if (!weekStart) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1">
        <button
          type="button"
          onClick={() => onWeekAnchorChange(addDays(weekStart, -7))}
          aria-label="Previous week"
          className="flex h-8 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-white"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1 text-center">
          <span className="flex items-center justify-center gap-1.5 text-xs font-medium text-gray-200">
            <CalendarDays size={12} className="text-gray-500" />
            {formatMedDate(weekStart)} – {formatMedDate(addDays(weekStart, 6))}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onWeekAnchorChange(addDays(weekStart, 7))}
          aria-label="Next week"
          className="flex h-8 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-white"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className="flex gap-2 sm:grid sm:grid-cols-7 sm:gap-1.5">
          {days.map(({ day, total, times }) => {
            const isCurrent = day === today;
            const isSelected = day === selected;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onPickDay(day)}
                className={cn(
                  'w-[92px] shrink-0 rounded-xl border p-2 text-left transition-colors sm:w-auto',
                  isSelected
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06]',
                  total === 0 && 'opacity-55'
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-wide',
                      isCurrent ? 'text-violet-300' : 'text-gray-500'
                    )}
                  >
                    {formatWeekdayShort(day)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-white tabular-nums">
                    {day.slice(8, 10)}
                  </span>
                </div>

                {total === 0 ? (
                  <p className="mt-2 text-[10px] text-gray-600">No doses</p>
                ) : (
                  <>
                    <p className="mt-1.5 text-[10px] font-medium text-gray-400">
                      {total} dose{total === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {times.map(([time, count]) => (
                        <li
                          key={time}
                          className="flex items-baseline justify-between gap-1 font-mono text-[10px] text-gray-400 tabular-nums"
                        >
                          <span>{time}</span>
                          <span className="text-gray-600">×{count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[11px] text-gray-600">
        Tap a day to open it. Courses drop off the grid once they finish.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- medicine card */

function MedicineCard({
  medication,
  onEdit,
  onDelete,
}: {
  medication: Medication;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = medColor(medication.color);
  // Same reason as the checklist chip: a malformed start_date must not throw
  // mid-render and take the whole medicines tab down.
  const end = safeCourseEndDate(medication);

  return (
    <article
      className={cn(
        'rounded-xl border border-white/8 bg-white/[0.03] p-3',
        !medication.active && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', color.dot)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-semibold text-white">{medication.name}</h3>
            {medication.strength && (
              <span className="font-mono text-[11px] text-gray-500 tabular-nums">
                {medication.strength}
              </span>
            )}
            {!medication.active && (
              <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                Paused
              </span>
            )}
          </div>

          <p className="mt-1 text-xs text-gray-400">
            {medication.dose_label} · {FREQUENCY_LABELS[medication.frequency_code]} ·{' '}
            {medication.form}
          </p>

          <div className="mt-1.5 flex flex-wrap gap-1">
            {medication.times_of_day.map((time) => (
              <span
                key={time}
                className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-gray-300 tabular-nums"
              >
                {time}
              </span>
            ))}
          </div>

          <p className="mt-1.5 text-[11px] text-gray-500">
            {formatMedDate(medication.start_date)}
            {end
              ? ` → ${formatMedDate(end)} · ${medication.duration_days} day course`
              : ' · ongoing'}
          </p>

          {medication.notes && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">{medication.notes}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${medication.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/8 hover:text-gray-200"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${medication.name}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}
