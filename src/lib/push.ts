import webpush from 'web-push';
import { getPushSubscriptions, deletePushSubscription } from '@/lib/meds';

/**
 * Web-push sender for the medicine reminders.
 *
 * Nothing in here is allowed to throw: a reminder failing to deliver must never
 * take down the cron dispatcher or an API route. Callers get back a count of
 * successful deliveries and decide what to do with a zero.
 */

/** Exactly the JSON shape the service worker reads out of `event.data`. */
export interface MedPushPayload {
  title: string;
  body: string;
  tag: string;
  medicationId: string | null;
  scheduledAt: string | null;
  doseCount: number;
  url: string;
}

const DEFAULT_SUBJECT = 'admin@babesstock.com';

/** True only when both halves of the VAPID key pair are present in the env. */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;

/**
 * Configure web-push lazily. Doing this at module scope would throw during the
 * build on any deploy that has not had the VAPID keys added yet.
 */
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  const raw = process.env.VAPID_SUBJECT ?? DEFAULT_SUBJECT;
  // web-push demands a mailto: or https: subject; tolerate either form in the env.
  const subject = /^(mailto:|https?:)/i.test(raw) ? raw : `mailto:${raw}`;

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidReady = true;
    return true;
  } catch {
    return false;
  }
}

/** 404 / 410 mean the browser threw the subscription away — stop keeping it. */
function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/**
 * Push `payload` to every device the user has registered.
 * Returns how many endpoints actually accepted it. Never throws.
 */
export async function sendPushToUser(userId: string, payload: MedPushPayload): Promise<number> {
  try {
    if (!ensureVapid()) return 0;

    const subscriptions = await getPushSubscriptions(userId);
    if (subscriptions.length === 0) return 0;

    const body = JSON.stringify(payload);
    let delivered = 0;

    await Promise.all(
      subscriptions.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            // A missed reminder is worthless an hour later, so keep the TTL short
            // and ask the push service to wake the device now.
            { TTL: 600, urgency: 'high' }
          );
          delivered++;
        } catch (e) {
          const status = (e as { statusCode?: number } | null)?.statusCode;
          if (isGoneStatus(status)) {
            try {
              // (endpoint, userId) — scoped so pruning a dead endpoint cannot
              // remove another account's row for the same browser profile.
              await deletePushSubscription(sub.endpoint, userId);
            } catch {
              /* pruning is best-effort */
            }
          }
        }
      })
    );

    return delivered;
  } catch {
    return 0;
  }
}
