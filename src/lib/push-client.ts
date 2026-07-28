/**
 * Browser-side push plumbing: service worker registration, notification
 * permission, and the subscribe / unsubscribe round trip with the API.
 *
 * Every browser API in here is feature-detected and every function is safe to
 * call during SSR (they no-op and return a falsy value). Nothing throws — a
 * failure to set up push must degrade to "the in-page alarm still works",
 * never to a crashed render.
 */

const SW_URL = '/sw.js';
const KEY_URL = '/api/meds/push/key';
const SUBSCRIBE_URL = '/api/meds/push/subscribe';
const UNSUBSCRIBE_URL = '/api/meds/push/unsubscribe';

/** navigator.serviceWorker.ready can hang forever; never block the UI on it. */
const READY_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- support

export function isServiceWorkerSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator;
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isPushSupported(): boolean {
  return isServiceWorkerSupported() && typeof window !== 'undefined' && 'PushManager' in window;
}

/** True when running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia can throw on very old WebKit */
  }
  // iOS Safari never implemented display-mode; it has its own flag.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// ---------------------------------------------------------------- registration

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: '/',
      // Never let the browser serve a stale worker out of its HTTP cache.
      updateViaCache: 'none',
    });

    // Prefer the fully-active registration, but don't wait forever for it.
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(resolve => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
    ]);

    return ready ?? registration;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// ---------------------------------------------------------------- subscribe

/**
 * VAPID keys travel as base64url text but `subscribe` wants raw bytes. The
 * explicit `<ArrayBuffer>` matters: a plain `Uint8Array` is backed by
 * `ArrayBufferLike`, which no longer satisfies `BufferSource`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function sameKey(existing: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  if (a.length !== wanted.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== wanted[i]) return false;
  return true;
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(KEY_URL, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { publicKey?: string | null };
    return body.publicKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe this device and hand the subscription to the server.
 * Returns false (never throws) when push is unavailable or unconfigured — the
 * common case being a deploy with no VAPID keys in the environment yet.
 */
export async function subscribeToPush(reg: ServiceWorkerRegistration | null): Promise<boolean> {
  if (!reg || !isPushSupported()) return false;

  const publicKey = await fetchPublicKey();
  if (!publicKey) return false;

  try {
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    let subscription = await reg.pushManager.getSubscription();

    // A subscription made against a rotated VAPID key is dead weight — the push
    // service will reject every send. Throw it away and make a fresh one.
    if (subscription && !sameKey(subscription.options?.applicationServerKey, applicationServerKey)) {
      try {
        await subscription.unsubscribe();
      } catch {
        /* it may already be gone */
      }
      subscription = null;
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

    const res = await fetch(SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/** True when this device already has a live push subscription. */
export async function hasPushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;

    // Tell the server first: if the browser-side unsubscribe succeeds but the
    // server keeps the row, it goes on pushing into a dead endpoint.
    try {
      await fetch(UNSUBSCRIBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } catch {
      /* best effort — the server prunes dead endpoints on send anyway */
    }

    await subscription.unsubscribe();
  } catch {
    /* nothing useful to do */
  }
}
