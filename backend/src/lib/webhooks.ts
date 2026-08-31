import { prisma } from "./prisma";
import { assertPublicHttpUrl } from "./ssrfGuard";

/**
 * Fire-and-forget webhook dispatch. Errors are logged only, never thrown,
 * so a slow/broken subscriber can never block the API request.
 */
export async function fireWebhooks(userId: string, event: string, payload: unknown) {
  try {
    const subs = await prisma.webhookSubscription.findMany({
      where: { userId, events: { has: event } },
    });
    for (const sub of subs) {
      dispatchOne(sub.url, event, payload);
    }
  } catch (err) {
    console.error("Webhook dispatch error:", err);
  }
}

async function dispatchOne(url: string, event: string, payload: unknown) {
  try {
    // Re-check right before dispatch: the URL was validated at
    // registration time, but DNS can change between then and now (TOCTOU).
    await assertPublicHttpUrl(url);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, item: payload }),
      redirect: "manual", // never follow redirects — a subscriber could point one at an internal host
    });

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      console.error(`Webhook delivery to ${url} refused: response was a redirect`);
    }
  } catch (err: any) {
    console.error(`Webhook delivery failed for ${url}:`, err.message);
  }
}
