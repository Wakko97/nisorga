import { prisma } from "../lib/prisma";
import { sendEmail } from "../lib/mailer";
import { getWeeklyReviewData } from "../routes/review";
import { AuthUser } from "../middleware/auth";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

function renderList(title: string, items: { id: string; title: string }[]) {
  if (items.length === 0) return `<h3>${title}</h3><p>Keine offenen Punkte 🎉</p>`;
  const rows = items
    .map((i) => `<li><a href="${FRONTEND_URL}/items/${i.id}">${i.title}</a></li>`)
    .join("");
  return `<h3>${title} (${items.length})</h3><ul>${rows}</ul>`;
}

/**
 * Weekly digest: for every user, aggregates the same data as GET
 * /review/weekly (reusing getWeeklyReviewData instead of duplicating the
 * queries) and emails a simple HTML summary.
 *
 * Exported separately so it can be triggered manually / from tests without
 * going through node-cron.
 */
export async function runWeeklyDigest() {
  const users = await prisma.user.findMany();
  let sent = 0;

  for (const user of users) {
    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const { openInboxItems, overdueTasks, staleIdeas } = await getWeeklyReviewData(authUser);

    if (openInboxItems.length === 0 && overdueTasks.length === 0 && staleIdeas.length === 0) {
      continue;
    }

    const html = `
      <h2>Dein Wochenrückblick</h2>
      ${renderList("Offene Inbox-Punkte", openInboxItems)}
      ${renderList("Überfällige Aufgaben", overdueTasks)}
      ${renderList("Unbearbeitete Ideen", staleIdeas)}
    `;

    await sendEmail(user.email, "Dein wöchentlicher Rückblick", html);
    sent++;
  }

  return { sent, users: users.length };
}
