import { prisma } from "./prisma";

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
      fetch(sub.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, item: payload }),
      }).catch((err) => {
        console.error(`Webhook delivery failed for ${sub.url}:`, err.message);
      });
    }
  } catch (err) {
    console.error("Webhook dispatch error:", err);
  }
}
