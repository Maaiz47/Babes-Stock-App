/*
 * Babes Stock — push-only service worker.
 *
 * There is deliberately NO fetch handler and NO offline cache. This app is
 * data-live: a cached page would show stale dose state, and showing a dose as
 * "not taken" when it has been taken (or the reverse) is exactly the failure a
 * medicine reminder must never have. The only job here is to wake the phone.
 */

/* global self */

const APP_URL = '/meds';
const ICON = '/icon-192.png';
const BADGE = '/badge-72.png';
const VIBRATE = [400, 200, 400, 200, 400];
const SNOOZE_MINUTES = 10;

self.addEventListener('install', () => {
  // Take over immediately — a reminder must never wait for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// ------------------------------------------------------------------ push

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed or plain-text payload must still ring: fall through to the
    // defaults below rather than dropping the reminder on the floor.
    data = {};
  }

  const title = typeof data.title === 'string' && data.title ? data.title : 'Time for your medicine';
  const body = typeof data.body === 'string' && data.body ? data.body : 'You have a dose due now.';
  // `renotify` is only legal alongside a tag, so the tag always has a fallback.
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'med-reminder';

  // Every reminder this worker shows is audible, full stop. There is no
  // quiet-hours path and no `silent` flag any more: this worker only ever
  // reminds about medicine, so a 22:00 antibiotic is precisely the dose that has
  // to wake her. A payload from an older deploy may still carry `silent: true` —
  // it is ignored rather than honoured, because a reminder she cannot hear is a
  // missed dose.
  const options = {
    body,
    tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: VIBRATE,
    badge: BADGE,
    icon: ICON,
    data: {
      url: typeof data.url === 'string' && data.url ? data.url : APP_URL,
      medicationId: data.medicationId ?? null,
      scheduledAt: data.scheduledAt ?? null,
      // Every dose this reminder stands for, as `${medication_id}|${scheduled_at}`.
      // A grouped "3 medicines due" has no single medicationId, so without these
      // an open tab could not tell what the notification was about and could
      // never close it — it outlived every dose in it being ticked off, with its
      // buttons still live. Kept as an array for the single-dose case too, so
      // the page has one shape to match against.
      doseKeys: Array.isArray(data.doseKeys)
        ? data.doseKeys.filter(key => typeof key === 'string' && key)
        : [],
    },
    actions: [
      { action: 'taken', title: 'Taken' },
      { action: 'snooze', title: 'Snooze 10m' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ------------------------------------------------------------------ click

self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const action = event.action;
  const data = (notification && notification.data) || {};

  notification.close();

  event.waitUntil(handleClick(action, data));
});

async function handleClick(action, data) {
  const medicationId = data.medicationId;
  const scheduledAt = data.scheduledAt;
  const url = typeof data.url === 'string' && data.url ? data.url : APP_URL;

  // The action buttons only make sense for a single identified dose. A grouped
  // reminder ("3 medicines due") has no id, so it falls through to opening the
  // app where she can tick each one off.
  if ((action === 'taken' || action === 'snooze') && medicationId && scheduledAt) {
    const result = await logDose(
      medicationId,
      scheduledAt,
      action === 'taken' ? 'taken' : 'pending',
      action === 'snooze' ? SNOOZE_MINUTES : undefined
    );

    if (result === 'ok') {
      // Tell any open tab so its checklist updates without a refresh.
      await notifyClients({
        type: 'med-dose-action',
        action,
        medicationId,
        scheduledAt,
        snoozeMinutes: action === 'snooze' ? SNOOZE_MINUTES : null,
      });
      return;
    }

    if (result === 'conflict') {
      // The dose is already settled — taken or skipped — and the server refused
      // to overwrite it. This tap came from a notification that has been sitting
      // there since before she dealt with it. Nothing to do and nothing to say:
      // the write was correctly rejected, the notification is already closed
      // above, and dragging her into the app to explain would only invite her to
      // "fix" a dose that is not broken.
      return;
    }
    // The write failed (offline, or the session expired). Open the app so she
    // can action the dose by hand rather than silently losing the tap.
  }

  await focusApp(url);
}

/**
 * POST the dose action. Returns 'ok', 'conflict' (the server refused because the
 * dose is already settled as taken or skipped), or 'failed'.
 *
 * `force` is deliberately never sent from here, and this is the one place in the
 * app that must not send it. A notification with requireInteraction can sit on
 * the lock screen for hours after the dose was dealt with in the app, and
 * forcing the write would flip a taken dose back to pending, blank its taken_at
 * and start alarming for medicine that is already in her — or overwrite a
 * deliberate skip with a "taken" she never meant. The API answers 409 in exactly
 * those cases and the caller above treats it as a no-op. Explicit taps inside
 * the app do send it, which is what makes undoing a mis-tap possible there.
 */
async function logDose(medicationId, scheduledAt, status, snoozeMinutes) {
  const body = { medication_id: medicationId, scheduled_at: scheduledAt, status };
  if (snoozeMinutes) body.snooze_minutes = snoozeMinutes;

  try {
    const res = await fetch('/api/meds/dose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) return 'ok';
    if (res.status === 409) return 'conflict';
    return 'failed';
  } catch {
    return 'failed';
  }
}

async function notifyClients(message) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) client.postMessage(message);
  } catch {
    /* best effort */
  }
}

/** Focus an already-open copy of the app, otherwise open one. */
async function focusApp(url) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of list) {
      if (client.url.includes(APP_URL) && 'focus' in client) return client.focus();
    }
    if (list.length > 0) {
      const client = list[0];
      if ('navigate' in client) {
        try {
          await client.navigate(url);
        } catch {
          /* navigation can be refused mid-unload; focusing is still useful */
        }
      }
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  } catch {
    /* nothing else we can do from here */
  }
}

// ------------------------------------------------------------------ resubscribe

/**
 * Browsers silently rotate push subscriptions. Without this the phone goes
 * quiet forever and nothing tells her why.
 */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(resubscribe());
});

async function resubscribe() {
  try {
    const res = await fetch('/api/meds/push/key', { credentials: 'include' });
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (!publicKey) return;

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const json = subscription.toJSON();
    await fetch('/api/meds/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
  } catch {
    /* the page will re-subscribe next time it is opened */
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
