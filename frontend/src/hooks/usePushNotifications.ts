import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Web Push's applicationServerKey wants a raw Uint8Array, but the VAPID
// public key is handed around as a URL-safe base64 string everywhere else
// (this is the standard MDN-documented conversion).
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export type PushSupportState = "unsupported" | "loading" | "subscribed" | "unsubscribed";

/**
 * Manages this browser's Web Push subscription for the current user:
 * whether the browser supports it, whether it's currently subscribed, and
 * subscribe()/unsubscribe() actions that also sync the subscription with
 * the backend (POST/DELETE /settings/push/subscribe).
 */
export function usePushNotifications() {
  const [state, setState] = useState<PushSupportState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setState(existing ? "subscribed" : "unsubscribed");
    }

    detect().catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Berechtigung für Benachrichtigungen wurde nicht erteilt.");
        return;
      }

      const { publicKey } = await api.get<{ publicKey: string | null }>("/settings/push/public-key");
      if (!publicKey) {
        setError("Push-Benachrichtigungen sind serverseitig nicht konfiguriert.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post("/settings/push/subscribe", subscription.toJSON());
      setState("subscribed");
    } catch (err) {
      console.error("Failed to subscribe to push notifications:", err);
      setError("Aktivieren fehlgeschlagen.");
    }
  }

  async function unsubscribe() {
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.delete(`/settings/push/subscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`);
        await subscription.unsubscribe();
      }
      setState("unsubscribed");
    } catch (err) {
      console.error("Failed to unsubscribe from push notifications:", err);
      setError("Deaktivieren fehlgeschlagen.");
    }
  }

  return { state, error, subscribe, unsubscribe };
}
