/// <reference lib="webworker" />
import { precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// App-shell precaching only; all real data comes from the API and must not
// be served stale/offline (same intent as navigateFallbackDenylist in the
// previous generateSW config - this custom service worker replaces that
// auto-generated one so it can also handle 'push').
precacheAndRoute(self.__WB_MANIFEST);

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let payload: PushPayload = { title: "Nisorga", body: "" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Not JSON (shouldn't happen - we control the payload backend-side) -
    // fall back to the default title/body rather than crashing the worker.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data?.url as string | undefined) ?? "/";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => c.url === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })()
  );
});
