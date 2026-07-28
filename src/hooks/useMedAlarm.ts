'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MedSettings, ScheduledDose } from '@/lib/meds';
import {
  isAudioSupported,
  isAudioUnlocked,
  normalizeAlarmSound,
  startAlarm,
  stopAlarm,
  unlockAudio,
  vibratePattern,
} from '@/lib/alarm';
import {
  hasPushSubscription,
  isNotificationSupported,
  registerServiceWorker,
  requestNotificationPermission,
  subscribeToPush,
} from '@/lib/push-client';

/**
 * The in-page half of the reminder system.
 *
 * Push notifications (fired by the cron dispatcher) cover the case where the app
 * is closed. This hook covers the case where it is open: it watches the day's
 * doses and, the moment one falls due, makes noise until it is dealt with.
 *
 * This is a reminder aid, not medical advice — it never decides anything about a
 * dose, it only surfaces what the prescription already says.
 */

export interface AlarmState {
  /** The dose the alert on screen is about. */
  activeDose: ScheduledDose | null;
  /**
   * True while an alert is up for `activeDose`, and an alert that is up is
   * always audible. Nothing in this hook may suppress reminder sound by time of
   * day: this engine only ever reminds about medicine, so the 22:00 dose is
   * exactly the one that has to wake her.
   */
  ringing: boolean;
  permission: NotificationPermission; // 'default' | 'granted' | 'denied'
  pushEnabled: boolean;
  audioUnlocked: boolean;
  supported: boolean;
}

/**
 * Extra intent carried alongside a dose write.
 *
 * `force` means "she tapped this, in the app, just now" — the only thing allowed
 * to move a dose out of a settled ('taken' / 'skipped') status. This hook never
 * sets it: the one write it makes is a replay of a notification button, and a
 * lock-screen reminder can outlive the dose it names by hours.
 */
export interface DoseActionOptions {
  force?: boolean;
}

interface UseMedAlarmOptions {
  doses: ScheduledDose[];
  settings: MedSettings | null;
  onAction: (
    dose: ScheduledDose,
    status: 'taken' | 'skipped',
    snoozeMin?: number,
    options?: DoseActionOptions
  ) => Promise<void>;
}

interface UseMedAlarmResult {
  state: AlarmState;
  enableAlarms: () => Promise<void>;
  testAlarm: () => void;
  stopRinging: () => void;
  dismissActive: () => void;
}

/** How often we re-check the schedule. */
const TICK_MS = 15_000;
/** How long the preview in the settings screen rings for. */
const TEST_MS = 3000;
/**
 * Stop chasing a dose that is more than half a day late. Without this, opening
 * the app on a past date would set off alarms for doses that are long gone.
 */
const MAX_OVERDUE_MS = 12 * 60 * 60 * 1000;

/**
 * Every reminder this app posts — from this page and from the service worker —
 * carries this tag, so a repeat replaces the one before it instead of stacking
 * a wall of notifications up on the lock screen.
 */
const DOSE_TAG = 'med-reminder';

const VIBRATE_PATTERN = [400, 200, 400, 200, 400];

// ---------------------------------------------------------------- capabilities

/**
 * Notification permission, audio-unlock and feature support all live in the
 * browser, not in React. They are read through useSyncExternalStore so that the
 * server render ('default' / false) hydrates cleanly into the real device value
 * instead of throwing a hydration mismatch.
 */
const capabilityListeners = new Set<() => void>();

function subscribeCapabilities(listener: () => void): () => void {
  capabilityListeners.add(listener);
  return () => {
    capabilityListeners.delete(listener);
  };
}

/** Call after anything that can change permission or the audio unlock. */
function notifyCapabilityChange(): void {
  for (const listener of capabilityListeners) listener();
}

function getSupported(): boolean {
  return isAudioSupported() || isNotificationSupported();
}

function getPermission(): NotificationPermission {
  return isNotificationSupported() ? Notification.permission : 'denied';
}

const serverSupported = () => false;
const serverPermission = (): NotificationPermission => 'default';
const serverAudioUnlocked = () => false;

// ---------------------------------------------------------------- time helpers

/**
 * When this dose should actually be reminded about.
 *
 * `effective_at`, not `scheduled_at`: when the previous dose of the same
 * medicine was swallowed late, the server pushes this one back so the two are
 * not taken too close together. Ringing on `scheduled_at` here would have the
 * in-app alarm firing at the original time while the push channel stayed quiet
 * until the deferred one — the two halves disagreeing about when a dose is due.
 *
 * Falls back to `scheduled_at` so a response from a deploy that predates the
 * field still rings rather than silently never coming due.
 */
function doseTime(dose: ScheduledDose): number {
  const effective = dose.effective_at ? Date.parse(dose.effective_at) : NaN;
  return Number.isNaN(effective) ? new Date(dose.scheduled_at).getTime() : effective;
}

/** The wall-clock date in her timezone for a given instant. */
function localDate(ms: number, tzOffsetMin: number): string {
  return new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/**
 * Does this dose still want a reminder in front of her?
 *
 * False once it has been taken or skipped, and while a snooze is running. It is
 * the single definition of "settled" used both for choosing what to ring about
 * and for deciding which notifications are stale enough to close.
 */
function doseNeedsReminder(dose: ScheduledDose, now: number, localSnoozeUntil?: number): boolean {
  if (dose.status !== 'pending') return false;
  if (now < snoozeWakeAt(dose, localSnoozeUntil)) return false;
  return true;
}

/**
 * The instant a snoozed dose is due to speak up again, or 0 when no snooze is
 * running. Takes the later of what the server stored and any snooze taken from
 * a notification button that this page has not refetched yet.
 */
function snoozeWakeAt(dose: ScheduledDose, localSnoozeUntil?: number): number {
  const stored = dose.snoozed_until ? new Date(dose.snoozed_until).getTime() : NaN;
  return Math.max(Number.isFinite(stored) ? stored : 0, localSnoozeUntil ?? 0);
}

// ---------------------------------------------------------------- notification

function doseBody(dose: ScheduledDose): string {
  const strength = dose.strength ? ` ${dose.strength}` : '';
  return `${dose.name}${strength} — ${dose.dose_label}`;
}

/** The active service worker registration, or null on every failure path. */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Every `${medication_id}|${scheduled_at}` dose key a notification stands for.
 *
 * A single-dose reminder names its dose through `medicationId` / `scheduledAt`
 * — the same two fields its action buttons write with. A grouped one ("3
 * medicines due") has no single medication id, so the dispatcher lists every
 * dose it covers in `doseKeys`; without that list the group could never be
 * matched against the schedule and so outlived every dose in it being ticked
 * off. Empty means "we cannot tell what this is about" — such a notification is
 * always left alone.
 */
function notificationDoseKeys(notification: Notification): string[] {
  const data = notification.data as
    | { doseKeys?: unknown; medicationId?: unknown; scheduledAt?: unknown }
    | null
    | undefined;
  if (!data || typeof data !== 'object') return [];

  if (Array.isArray(data.doseKeys)) {
    const keys = data.doseKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (keys.length > 0) return keys;
  }

  const medicationId = typeof data.medicationId === 'string' ? data.medicationId : '';
  const scheduledAt = typeof data.scheduledAt === 'string' ? data.scheduledAt : '';
  if (!medicationId || !scheduledAt) return [];

  const at = new Date(scheduledAt).getTime();
  if (!Number.isFinite(at)) return [];
  return [`${medicationId}|${new Date(at).toISOString()}`];
}

/**
 * Take down every notification whose doses have all been dealt with.
 *
 * This is a safety fix, not tidiness: both halves of the system post with
 * `requireInteraction: true`, so a reminder sits there until it is tapped. Its
 * "Snooze" button would then rewrite a dose she has already taken back to
 * pending and start alarming for a dose that is already in her.
 *
 * `settled` is the set of dose keys we currently believe need no reminder. A
 * notification is closed only when EVERY dose it names is in that set, so a
 * grouped reminder survives until the last of its doses is settled — one ticked
 * medicine out of three must not take the reminder for the other two away.
 *
 * The list is fetched unfiltered rather than with `{ tag: DOSE_TAG }`: matching
 * is done on the dose identity carried in `data`, which is exact, so a tag
 * filter could only ever lose a notification that needs closing.
 */
async function closeSettledNotifications(settled: Set<string>): Promise<void> {
  if (settled.size === 0) return;
  if (typeof window === 'undefined') return;

  try {
    const registration = await getRegistration();
    if (!registration || typeof registration.getNotifications !== 'function') return;

    const shown = await registration.getNotifications();
    for (const notification of shown) {
      const keys = notificationDoseKeys(notification);
      if (keys.length === 0) continue;
      if (!keys.every(key => settled.has(key))) continue;
      if (typeof notification.close === 'function') notification.close();
    }
  } catch {
    /* closing notifications is best effort — never let it break the alarm */
  }
}

/**
 * Post the reminder through the service worker registration — and only through
 * it.
 *
 * There is deliberately no `new Notification()` fallback. One posted that way
 * belongs to the page rather than the registration, so `getNotifications()`
 * never returns it and nothing above could ever close it: it would sit on the
 * lock screen with live "Taken" / "Snooze" buttons long after the dose was
 * dealt with, which is the exact hazard this file spends its time preventing.
 * It also carries neither action buttons nor `requireInteraction`, so it is a
 * worse reminder in the first place. With no registration we post nothing — the
 * audible alarm and the full-screen overlay are the real reminder here, and the
 * registration is created on mount so this is very nearly unreachable.
 */
async function showDoseNotification(dose: ScheduledDose): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const title = 'Time for your medicine';
  // `vibrate`, `renotify` and `actions` are real, widely-shipped fields that the
  // DOM typings still do not carry — hence the cast.
  //
  // Never silent, and always with a vibration pattern: a reminder she cannot
  // hear is a missed dose, whatever the hour.
  const options = {
    body: doseBody(dose),
    tag: DOSE_TAG,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: VIBRATE_PATTERN,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: {
      url: '/meds',
      medicationId: dose.medication_id,
      scheduledAt: dose.scheduled_at,
      // Same shape the pushed reminders carry, so one close path covers both.
      doseKeys: [dose.key],
    },
    actions: [
      { action: 'taken', title: 'Taken' },
      { action: 'snooze', title: 'Snooze 10m' },
    ],
  } as unknown as NotificationOptions;

  try {
    const registration = await getRegistration();
    if (!registration || typeof registration.showNotification !== 'function') return;
    await registration.showNotification(title, options);
  } catch {
    /* notifications are best-effort; the audible alarm is the real reminder */
  }
}

// ---------------------------------------------------------------- the hook

export function useMedAlarm({ doses, settings, onAction }: UseMedAlarmOptions): UseMedAlarmResult {
  const supported = useSyncExternalStore(subscribeCapabilities, getSupported, serverSupported);
  const permission = useSyncExternalStore(subscribeCapabilities, getPermission, serverPermission);
  const audioUnlocked = useSyncExternalStore(subscribeCapabilities, isAudioUnlocked, serverAudioUnlocked);

  const [ring, setRing] = useState<{ activeDose: ScheduledDose | null; ringing: boolean }>({
    activeDose: null,
    ringing: false,
  });
  const [pushEnabled, setPushEnabled] = useState(false);

  const dosesRef = useRef<ScheduledDose[]>(doses);
  const settingsRef = useRef<MedSettings | null>(settings);
  const onActionRef = useRef(onAction);

  /**
   * Three separate facts, deliberately not one flag:
   *
   *  - `activeKeyRef`  which dose the alert on screen is about
   *  - `alertingRef`   that alert is still live (she has not stopped or dealt with it)
   *  - `soundingRef`   the audio engine is running *right now*
   *
   * Nothing may now silence an alert while leaving it up — quiet hours were the
   * only thing that did, and they are gone. The three are still kept apart so
   * that a live alert which has somehow fallen quiet is a state `evaluate` can
   * see and repair (it starts the sound again) rather than one it cannot
   * represent; a mute alert is the failure this whole file exists to avoid.
   */
  const activeKeyRef = useRef<string | null>(null);
  const alertingRef = useRef(false);
  const soundingRef = useRef(false);

  /** dose key -> how many times it has rung, and when it last started. */
  const ringsRef = useRef<Map<string, { count: number; lastAt: number }>>(new Map());
  /** dose key -> epoch ms, for a snooze taken from a notification button. */
  const localSnoozeRef = useRef<Map<string, number>>(new Map());

  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enablingRef = useRef(false);

  // Mirror the props into refs so the 15s tick can read the latest data without
  // being torn down and rebuilt on every refetch. This runs after every render,
  // and before the effects below that use it — effects fire in declaration order.
  useEffect(() => {
    dosesRef.current = doses;
    settingsRef.current = settings;
    onActionRef.current = onAction;
  });

  // -------------------------------------------------------------- ring control

  /**
   * Every dose key we currently believe needs no reminder, plus — optionally —
   * one she has just actioned from a notification button, which the page has
   * not refetched yet. Grouped reminders are matched against this whole set,
   * so it has to describe the day rather than the single dose in hand.
   */
  const collectSettledKeys = useCallback((justActioned?: string): Set<string> => {
    const now = Date.now();
    const settled = new Set<string>();
    for (const dose of dosesRef.current) {
      if (!doseNeedsReminder(dose, now, localSnoozeRef.current.get(dose.key))) settled.add(dose.key);
    }
    if (justActioned) settled.add(justActioned);
    return settled;
  }, []);

  /**
   * Close the notification for a dose we are letting go of, but only when the
   * data we hold says it no longer needs a reminder. Deliberately conservative:
   * a dose that is simply not in the current list (she is looking at another
   * day) tells us nothing, and dropping a live reminder is far worse than
   * leaving a stale one on screen for a few more minutes.
   */
  const closeSettledNotification = useCallback(
    (key: string) => {
      const dose = dosesRef.current.find(d => d.key === key);
      if (!dose) return;
      if (doseNeedsReminder(dose, Date.now(), localSnoozeRef.current.get(key))) return;
      void closeSettledNotifications(collectSettledKeys());
    },
    [collectSettledKeys]
  );

  /**
   * She silenced this alert. Nothing is recorded against the dose: it stays due
   * on the checklist, and the repeat budget brings the alarm back.
   */
  const stopRinging = useCallback(() => {
    stopAlarm();
    soundingRef.current = false;
    alertingRef.current = false;
    setRing(prev => (prev.ringing ? { ...prev, ringing: false } : prev));
  }, []);

  const dismissActive = useCallback(() => {
    stopAlarm();
    const key = activeKeyRef.current;
    soundingRef.current = false;
    alertingRef.current = false;
    activeKeyRef.current = null;
    setRing(prev => (prev.ringing || prev.activeDose ? { activeDose: null, ringing: false } : prev));
    if (key) closeSettledNotification(key);
  }, [closeSettledNotification]);

  /** Is this dose one we should be making noise about right now? */
  const isRingable = useCallback((dose: ScheduledDose, now: number, tzOffsetMin: number): boolean => {
    if (!doseNeedsReminder(dose, now, localSnoozeRef.current.get(dose.key))) return false;

    const at = doseTime(dose);
    if (!Number.isFinite(at) || now < at) return false;
    if (now - at > MAX_OVERDUE_MS) return false;

    // Only today's (or last night's, across midnight) doses may ring, so that
    // browsing back through history never sets the phone off.
    const doseDay = localDate(at, tzOffsetMin);
    const today = localDate(now, tzOffsetMin);
    const yesterday = localDate(now - 86_400_000, tzOffsetMin);
    if (doseDay !== today && doseDay !== yesterday) return false;

    return true;
  }, []);

  const evaluate = useCallback(() => {
    if (typeof window === 'undefined') return;

    const currentSettings = settingsRef.current;
    const now = Date.now();

    if (!currentSettings || !currentSettings.alarm_enabled) {
      if (soundingRef.current || alertingRef.current || activeKeyRef.current) dismissActive();
      return;
    }

    const tz = currentSettings.tz_offset_minutes;
    const candidates = dosesRef.current
      .filter(d => isRingable(d, now, tz))
      .sort((a, b) => doseTime(a) - doseTime(b));

    // Whatever is on screen has been dealt with (or snoozed) — let it go.
    const activeKey = activeKeyRef.current;
    const activeDose = activeKey ? candidates.find(d => d.key === activeKey) : undefined;
    if (activeKey && !activeDose) dismissActive();

    // An alert that is already up stays up, and it is always audible. If the
    // sound is not running underneath it — the audio engine was interrupted, or
    // it never managed to start — start it here rather than leaving a mute
    // reminder on screen. Nothing sets `alertingRef` without `soundingRef` any
    // more, so this is a repair path, not the normal one.
    if (activeDose && alertingRef.current) {
      if (!soundingRef.current) {
        startAlarm(normalizeAlarmSound(currentSettings.alarm_sound), currentSettings.alarm_volume);
        vibratePattern();
        soundingRef.current = true;
      }
      return;
    }

    // Nothing is alerting. Take the earliest dose that still has an alert left in
    // it, stepping over ones whose repeats are spent or whose repeat interval has
    // not elapsed yet — stopping at the earliest dose unconditionally is what let
    // a single stuck dose mute every later dose of the day.
    const intervalMs = Math.max(1, currentSettings.repeat_interval_min) * 60_000;
    const next = candidates.find(d => {
      const record = ringsRef.current.get(d.key);
      if (!record) return true;
      if (record.count >= currentSettings.max_repeats) return false;
      return now - record.lastAt >= intervalMs;
    });
    if (!next) return;

    const record = ringsRef.current.get(next.key) ?? { count: 0, lastAt: 0 };
    ringsRef.current.set(next.key, { count: record.count + 1, lastAt: now });

    activeKeyRef.current = next.key;
    alertingRef.current = true;
    setRing({ activeDose: next, ringing: true });

    startAlarm(normalizeAlarmSound(currentSettings.alarm_sound), currentSettings.alarm_volume);
    vibratePattern();
    soundingRef.current = true;

    void showDoseNotification(next);
  }, [dismissActive, isRingable]);

  // -------------------------------------------------------------- lifecycle

  // Registering up front costs nothing, makes the app installable, and means
  // notifications work the instant permission is granted.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await registerServiceWorker();
      const subscribed = await hasPushSubscription();
      if (!cancelled) setPushEnabled(subscribed);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The 15s tick. Deliberately independent of the doses prop so a refetch never
  // resets the clock.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = setInterval(evaluate, TICK_MS);
    return () => clearInterval(id);
  }, [evaluate]);

  // Re-check immediately whenever the data changes, so ticking a dose off stops
  // the alarm at once instead of up to 15 seconds later.
  useEffect(() => {
    evaluate();
  }, [doses, settings, evaluate]);

  // Fresh data is the moment to reconcile two things with it.
  //
  // 1. A notification for a dose that has since been taken, skipped or snoozed
  //    is not just clutter: its buttons stay live, and a stray "Snooze" tap
  //    hours later would rewrite a taken dose back to pending. Take it down
  //    whichever route actioned the dose — this page, the notification buttons,
  //    or another device.
  // 2. A snooze buys a dose a new wake time, so it must buy it a new ring budget
  //    too. Without this the count from before the snooze survived it, and once
  //    the budget was spent, snoozing brought nothing back: the alarm went quiet
  //    for good on a dose she had explicitly asked to be reminded about again.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    const settled = new Set<string>();
    for (const dose of doses) {
      const localSnooze = localSnoozeRef.current.get(dose.key);
      if (!doseNeedsReminder(dose, now, localSnooze)) settled.add(dose.key);
      if (snoozeWakeAt(dose, localSnooze) > now) ringsRef.current.delete(dose.key);
    }
    void closeSettledNotifications(settled);
  }, [doses]);

  // Coming back to the app is the moment she is most likely to act on a dose.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') evaluate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [evaluate]);

  // Notification buttons are handled inside the service worker (it has to work
  // when no tab is open). When a tab *is* open it tells us, so the UI keeps up.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        action?: string;
        medicationId?: string;
        scheduledAt?: string;
        snoozeMinutes?: number | null;
      } | null;
      if (!data || data.type !== 'med-dose-action') return;

      const key = `${data.medicationId}|${data.scheduledAt}`;
      const dose = dosesRef.current.find(d => d.key === key);

      if (data.action === 'snooze') {
        const minutes = data.snoozeMinutes ?? settingsRef.current?.snooze_min ?? 10;
        localSnoozeRef.current.set(key, Date.now() + minutes * 60_000);
        // New wake time, new ring budget — see the effect above.
        ringsRef.current.delete(key);
        if (activeKeyRef.current === key) dismissActive();
        // Only now, with the snooze recorded, does this dose count as settled.
        void closeSettledNotifications(collectSettledKeys(key));
        return;
      }

      if (data.action === 'taken') {
        if (activeKeyRef.current === key) dismissActive();
        // The page has not refetched yet, so this dose still reads 'pending'
        // here — name it explicitly as the one she just dealt with.
        void closeSettledNotifications(collectSettledKeys(key));
        // The worker already wrote it; replaying through onAction is what pulls
        // the fresh state back into the page. The write is an upsert, so doing
        // it twice is harmless. No `force`: this is a notification button, and
        // one can sit on the lock screen for hours after the dose was settled
        // in the app — it must never overwrite a decision she made since.
        if (dose) void onActionRef.current(dose, 'taken');
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [dismissActive, collectSettledKeys]);

  // Never leave a sound running behind an unmounted screen.
  useEffect(() => {
    return () => {
      if (testTimerRef.current) {
        clearTimeout(testTimerRef.current);
        testTimerRef.current = null;
      }
      stopAlarm();
      soundingRef.current = false;
      alertingRef.current = false;
    };
  }, []);

  // -------------------------------------------------------------- actions

  const enableAlarms = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (enablingRef.current) return;
    enablingRef.current = true;

    try {
      // Order matters: the AudioContext must be unlocked while we are still
      // inside the user's tap, before any await on a permission dialog.
      await unlockAudio();
      notifyCapabilityChange();

      const granted = await requestNotificationPermission();
      notifyCapabilityChange();

      const registration = await registerServiceWorker();

      if (granted === 'granted' && registration) {
        setPushEnabled(await subscribeToPush(registration));
      } else {
        setPushEnabled(await hasPushSubscription());
      }
    } catch {
      /* every step already degrades on its own; nothing to add here */
    } finally {
      enablingRef.current = false;
    }
  }, []);

  const testAlarm = useCallback(() => {
    if (typeof window === 'undefined') return;
    const currentSettings = settingsRef.current;

    startAlarm(
      normalizeAlarmSound(currentSettings?.alarm_sound),
      currentSettings?.alarm_volume ?? 1
    );
    vibratePattern();

    if (testTimerRef.current) clearTimeout(testTimerRef.current);
    testTimerRef.current = setTimeout(() => {
      testTimerRef.current = null;
      // A real dose may have come due mid-preview; never cut that short.
      if (!soundingRef.current) stopAlarm();
    }, TEST_MS);
  }, []);

  const state = useMemo<AlarmState>(
    () => ({
      activeDose: ring.activeDose,
      ringing: ring.ringing,
      permission,
      pushEnabled,
      audioUnlocked,
      supported,
    }),
    [ring, permission, pushEnabled, audioUnlocked, supported]
  );

  return { state, enableAlarms, testAlarm, stopRinging, dismissActive };
}

export default useMedAlarm;
