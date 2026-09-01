import "dotenv/config";
import cron from "node-cron";

import { assertRequiredEnv } from "./lib/assertRequiredEnv";

assertRequiredEnv();

import { app } from "./app";
import { prisma } from "./lib/prisma";
import { runReminderCheck } from "./jobs/reminders";
import { runWeeklyDigest } from "./jobs/weeklyDigest";
import { runImapPoll } from "./jobs/imapPoll";

const PORT = process.env.PORT || 4000;

// Ensure the singleton AppState row exists (chosen over a data-only
// migration statement so this stays correct even if the row is ever lost).
prisma.appState
  .upsert({ where: { id: 1 }, update: {}, create: { id: 1, initialized: false } })
  .catch((err) => console.error("Failed to ensure AppState row:", err));

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});

// Cron jobs run in the same Node process as the API server. They are
// disabled in test mode so tests don't trigger background email sends.
if (process.env.NODE_ENV !== "test") {
  // Daily at 09:00 — remind about items stuck in WAITING.
  cron.schedule("0 9 * * *", () => {
    runReminderCheck().catch((err) => console.error("[cron] reminder check failed:", err));
  });

  // Fridays at 08:00 — weekly review digest.
  cron.schedule("0 8 * * 5", () => {
    runWeeklyDigest().catch((err) => console.error("[cron] weekly digest failed:", err));
  });

  // Every 2 minutes — poll IMAP for inbound email capture (replaces the old
  // SendGrid Inbound Parse webhook). No-ops on its own when IMAP_HOST isn't
  // configured, so this doesn't need its own env guard here.
  const imapPollCron = process.env.IMAP_POLL_CRON || "*/2 * * * *";
  cron.schedule(imapPollCron, () => {
    runImapPoll().catch((err) => console.error("[cron] IMAP poll failed:", err));
  });
}
