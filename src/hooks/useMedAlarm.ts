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
   * True while an alert is up for `activeDose`. The *sound* can be suppressed
   * underneath it by quiet hours — quiet hours silence noise, they never hide
   * the fact that a dose is due.
   */
  ringing: boolean;
  permission: NotificationPermission; // 'default' | 'granted' | 'denied'
  pushEnabled: boolean;
  audioUnlocked: boolean;
  supported: boolean;
}

interface UseMedAlarmOptions {
  doses: ScheduledDose[];
  settings: MedSettings | null;
  onAction: (dose: ScheduledDose, status: 'taken' | 'skipped', snoozeMin?: number) => Promise<void>;
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

function doseTime(dose: ScheduledDose): number {
  return new Date(dose.scheduled_at).getTime();
}

/** The wall-clock date in her timezone for a given instant. */
function localDate(ms: number, tzOffsetMin: number): string {
  return new Date(ms + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** Minutes since local midnight, in her timezone. */
function localMinutes(ms: number, tzOffsetMin: number): number {
  const shifted = new Date(ms + tzOffsetMin * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Quiet hours silence the sound only — the dose still shows as overdue. */
function inQuietHours(settings: MedSettings, now: number): boolean {
  const start = parseHHMM(settings.quiet_hours_start);
  const end = parseHHMM(settings.quiet_hours_end);
  if (start === null || end === null || start === end) return false;

  const minutes = localMinutes(now, settings.tz_offset_minutes);
  // A window like 22:00 -> 07:00 wraps around midnight.
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
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

  if (dose.snoozed_until) {
    const until = new Date(dose.snoozed_until).getTime();
    if (Number.isFinite(until) && now < until) return false;
  }
  if (localSnoozeUntil && now < localSnoozeUntil) return false;

  return true;
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
 * The `${medication_id}|${scheduled_at}` key a notification is about, or null
 * when it does not name one single dose (a grouped "3 medicines due" reminder
 * carries no medication id, and its buttons deliberately write nothing).
 */
function notificationDoseKey(notification: Notification): string | null {
  const data = notification.data as { medicationId?: unknown; scheduledAt?: unknown } | null | undefined;
  if (!data || typeof data !== 'object') return null;

  const medicationId = typeof data.medicationId === 'string' ? data.medicationId : '';
  const scheduledAt = typeof data.scheduledAt === 'string' ? data.scheduledAt : '';
  if (!medicationId || !scheduledAt) return null;

  const at = new Date(scheduledAt).getTime();
  if (!Number.isFinite(at)) return null;
  return `${medicationId}|${new Date(at).toISOString()}`;
}

/**
 * Take down any notification still on screen for one of these doses.
 *
 * This is a safety fix, not tidiness: both halves of the system post with
 * `requireInteraction: true`, so a reminder sits there until it is tapped. Its
 * "Snooze" button would then rewrite a dose she has already taken back to
 * pending and start alarming for a dose that is already in her.
 *
 * The list is fetched unfiltered rather than with `{ tag: DOSE_TAG }`: matching
 * is done on the dose identity carried in `data`, which is exact, so a tag
 * filter could only ever lose a notification that needs closing.
 */
async function closeNotificationsForKeys(keys: Set<string>): Promise<void> {
  if (keys.size === 0) return;
  if (typeof window === 'undefined') return;

  try {
    const registration = await getRegistration();
    if (!registration || typeof registration.getNotifications !== 'function') return;

    const shown = await registration.getNotifications();
    for (const notification of shown) {
      const key = notificationDoseKey(notification);
      if (key && keys.has(key) && typeof notification.close === 'function') notification.close();
    }
  } catch {
    /* closing notifications is best effort — never let it break the alarm */
  }
}

/**
 * Post the reminder through the service worker when we can: notifications shown
 * by a registration survive the tab being backgrounded and can carry buttons,
 * which `new Notification()` cannot.
 */
async function showDoseNotification(dose: ScheduledDose, silent: boolean): Promise<void> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const title = 'Time for your medicine';
  // `vibrate`, `renotify` and `actions` are real, widely-shipped fields that the
  // DOM typings still do not carry — hence the cast.
  const base = {
    body: doseBody(dose),
    tag: DOSE_TAG,
    renotify: true,
    requireInteraction: true,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: {
      url: '/meds',
      medicationId: dose.medication_id,
      scheduledAt: dose.scheduled_at,
    },
    actions: [
      { action: 'taken', title: 'Taken' },
      { action: 'snooze', title: 'Snooze 10m' },
    ],
  };
  // A silent notification must not carry a vibration pattern — Chrome throws a
  // TypeError on that combination — so the two are never both present.
  const options = (
    silent ? { ...base, silent: true } : { ...base, silent: false, vibrate: VIBRATE_PATTERN }
  ) as unknown as NotificationOptions;

  try {
    const registration = await getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through to the plain Notification below */
  }

  try {
    new Notification(title, options);
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
   * They come apart during quiet hours: the alert stays live and visible while
   * the sound is off. Collapsing them into one flag is what let a dose that fell
   * inside quiet hours pin the engine — quiet hours were then evaluated exactly
   * once for that dose, never re-checked when the window ended, and every later
   * dose was short-circuited behind it.
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
   * Close the notification for a dose we are letting go of, but only when the
   * data we hold says it no longer needs a reminder. Deliberately conservative:
   * a dose that is simply not in the current list (she is looking at another
   * day) tells us nothing, and dropping a live reminder is far worse than
   * leaving a stale one on screen for a few more minutes.
   */
  const closeSettledNotification = useCallback((key: string) => {
    const dose = dosesRef.current.find(d => d.key === key);
    if (!dose) return;
    if (doseNeedsReminder(dose, Date.now(), localSnoozeRef.current.get(key))) return;
    void closeNotificationsForKeys(new Set([key]));
  }, []);

  /** She asked for quiet. The dose stays on screen; the repeat timer brings it back. */
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

    // Quiet hours are re-read on EVERY tick, for a dose that is already alerting
    // as much as for a new one. Deciding it once, when the dose first came due,
    // is what left a 07:00 dose silent for the rest of a 22:00 -> 08:00 window
    // and every dose behind it unannounced with it.
    const quiet = inQuietHours(currentSettings, now);

    // An alert that is already up stays up; only its sound follows quiet hours.
    if (activeDose && alertingRef.current) {
      if (quiet) {
        if (soundingRef.current) {
          // The window opened underneath a sounding alarm. Drop the noise, keep
          // the alert: `alertingRef` stays set, so the sound comes back below
          // the moment the window ends.
          stopAlarm();
          soundingRef.current = false;
        }
      } else if (!soundingRef.current) {
        // Either the window just ended, or this alert started inside it. Either
        // way she is meant to hear this one now.
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

    if (quiet) {
      // Belt and braces: never leave the engine running behind a silent alert.
      if (soundingRef.current) stopAlarm();
      soundingRef.current = false;
    } else {
      startAlarm(normalizeAlarmSound(currentSettings.alarm_sound), currentSettings.alarm_volume);
      vibratePattern();
      soundingRef.current = true;
    }

    // The reminder itself is always posted. Quiet hours only take away the noise:
    // silent, no vibration, but still on the lock screen and still overdue.
    void showDoseNotification(next, quiet);
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

  // A notification for a dose that has since been taken, skipped or snoozed is
  // not just clutter: its buttons stay live, and a stray "Snooze" tap hours later
  // would rewrite a taken dose back to pending. Fresh data is the moment to take
  // them down, whichever route actioned the dose — this page, the notification
  // buttons, or another device.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    const settled = new Set<string>();
    for (const dose of doses) {
      if (!doseNeedsReminder(dose, now, localSnoozeRef.current.get(dose.key))) settled.add(dose.key);
    }
    void closeNotificationsForKeys(settled);
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

      // She has just dealt with this dose from a notification, so any other
      // notification still up for it is stale by definition.
      void closeNotificationsForKeys(new Set([key]));

      if (data.action === 'snooze') {
        const minutes = data.snoozeMinutes ?? settingsRef.current?.snooze_min ?? 10;
        localSnoozeRef.current.set(key, Date.now() + minutes * 60_000);
        if (activeKeyRef.current === key) dismissActive();
        return;
      }

      if (data.action === 'taken') {
        if (activeKeyRef.current === key) dismissActive();
        // The worker already wrote it; replaying through onAction is what pulls
        // the fresh state back into the page. The write is an upsert, so doing
        // it twice is harmless.
        if (dose) void onActionRef.current(dose, 'taken');
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [dismissActive]);

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
