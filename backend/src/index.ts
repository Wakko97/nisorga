import "dotenv/config";
import cron from "node-cron";

import { app } from "./app";
import { runReminderCheck } from "./jobs/reminders";
import { runWeeklyDigest } from "./jobs/weeklyDigest";

const PORT = process.env.PORT || 4000;

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
}
