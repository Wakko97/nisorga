import webpush from "web-push";
import { prisma } from "./prisma";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let configured = false;
function ensureConfigured(): boolean {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

/** Whether Web Push is configured at all (VAPID_PUBLIC_KEY/PRIVATE_KEY set). */
export function isPushConfigured(): boolean {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY || null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Sends a push notification to every device/browser the given user has
 * subscribed on. No-ops (with a console warning) when VAPID keys aren't
 * configured, same graceful-degradation pattern as the mailer. A
 * subscription that the push service reports as gone (410) or not found
 * (404) - the browser unsubscribed, uninstalled, or cleared data - is
 * deleted so we stop wasting a request on it every time.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID keys not set — skipping push to user ${userId}: "${payload.title}"`);
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          console.error(`[push] Failed to send to subscription ${sub.id}:`, err);
        }
      }
    })
  );
}
