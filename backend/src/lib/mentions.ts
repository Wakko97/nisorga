import { prisma } from "./prisma";
import { sendEmail } from "./sendgrid";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// A mention token is whatever follows "@" up to whitespace/punctuation,
// e.g. "@lisa" or "@lisa.mueller" — matched against each user's name with
// spaces stripped, or their email's local part, both case-insensitively.
const MENTION_PATTERN = /@([a-zA-Z0-9._-]+)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractMentionTokens(body: string): string[] {
  const tokens = new Set<string>();
  for (const match of body.matchAll(MENTION_PATTERN)) {
    tokens.add(match[1].toLowerCase());
  }
  return Array.from(tokens);
}

/**
 * Finds users mentioned via "@token" in a comment body and emails each of
 * them (except the comment's own author) a link to the item. Best-effort:
 * failures are logged, never thrown, so a broken mention never blocks
 * posting the comment itself.
 */
export async function notifyMentionedUsers(params: {
  body: string;
  itemId: string;
  itemTitle: string;
  authorId: string;
  authorName: string;
}) {
  try {
    const tokens = extractMentionTokens(params.body);
    if (tokens.length === 0) return;

    const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
    const mentioned = users.filter((u) => {
      if (u.id === params.authorId) return false;
      const nameSlug = u.name.replace(/\s+/g, "").toLowerCase();
      const emailLocal = u.email.split("@")[0].toLowerCase();
      return tokens.includes(nameSlug) || tokens.includes(emailLocal);
    });

    const link = `${FRONTEND_URL}/items/${params.itemId}`;
    for (const user of mentioned) {
      await sendEmail(
        user.email,
        `${params.authorName} hat dich in einem Kommentar erwähnt`,
        `<p>${escapeHtml(params.authorName)} hat dich in einem Kommentar zu "<strong>${escapeHtml(params.itemTitle)}</strong>" erwähnt:</p>
         <p>${escapeHtml(params.body)}</p>
         <p><a href="${link}">Zum Item</a></p>`
      );
    }
  } catch (err) {
    console.error("Mention notification error:", err);
  }
}
