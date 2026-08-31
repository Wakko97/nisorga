import { prisma, publicUserSelect } from "../lib/prisma";
import { sendEmail } from "../lib/mailer";
import { getWaitingReminderDays } from "../lib/appConfig";

/**
 * Finds all items stuck in WAITING (delegated, awaiting a reply) for longer
 * than the configured reminder threshold (Settings, falling back to
 * WAITING_REMINDER_DAYS) and sends a reminder email to whoever is involved
 * (assignee and/or creator, if set and distinct).
 *
 * Exported separately so it can be triggered manually / from tests without
 * going through node-cron.
 */
export async function runReminderCheck() {
  const reminderDays = await getWaitingReminderDays();
  const cutoff = new Date(Date.now() - reminderDays * 24 * 60 * 60 * 1000);

  const items = await prisma.item.findMany({
    where: { status: "WAITING", waitingSince: { lt: cutoff } },
    include: { createdBy: { select: publicUserSelect }, assignedTo: { select: publicUserSelect } },
  });

  for (const item of items) {
    const days = item.waitingSince
      ? Math.floor((Date.now() - item.waitingSince.getTime()) / (24 * 60 * 60 * 1000))
      : reminderDays;

    const recipients = new Map<string, string>();
    if (item.assignedTo) recipients.set(item.assignedTo.id, item.assignedTo.email);
    if (item.createdBy) recipients.set(item.createdBy.id, item.createdBy.email);

    const subject = `Erinnerung: "${item.title}" wartet seit ${days} Tagen`;
    const html = `
      <p>Der Punkt <strong>${item.title}</strong> wartet seit ${days} Tagen auf eine Rückmeldung.</p>
      <p>${item.description ?? ""}</p>
    `;

    for (const email of recipients.values()) {
      await sendEmail(email, subject, html);
    }
  }

  return { checked: items.length };
}
