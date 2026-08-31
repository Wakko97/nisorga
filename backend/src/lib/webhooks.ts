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
      dispatchOne(sub.url, event, payload, sub.format);
    }
  } catch (err) {
    console.error("Webhook dispatch error:", err);
  }
}

/** Renders a compact one-line summary, e.g. "item.created: Rechnung prüfen". */
function slackText(event: string, payload: unknown): string {
  const title = payload && typeof payload === "object" && "title" in payload ? String((payload as any).title) : null;
  return title ? `*${event}*: ${title}` : `*${event}*`;
}

async function dispatchOne(url: string, event: string, payload: unknown, format: string) {
  try {
    // Re-check right before dispatch: the URL was validated at
    // registration time, but DNS can change between then and now (TOCTOU).
    await assertPublicHttpUrl(url);

    // Slack/Teams incoming webhooks expect {text}, not our generic
    // {event, item} envelope — the generic form isn't rendered as text.
    const body = format === "SLACK" ? { text: slackText(event, payload) } : { event, item: payload };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual", // never follow redirects — a subscriber could point one at an internal host
    });

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      console.error(`Webhook delivery to ${url} refused: response was a redirect`);
    }
  } catch (err: any) {
    console.error(`Webhook delivery failed for ${url}:`, err.message);
  }
}
