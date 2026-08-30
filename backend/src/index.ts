import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import cron from "node-cron";

import authRouter from "./routes/auth";
import itemsRouter from "./routes/items";
import usersRouter from "./routes/users";
import googleIntegrationRouter from "./routes/googleIntegration";
import settingsRouter from "./routes/settings";
import apiV1Router from "./routes/apiV1";
import reviewRouter from "./routes/review";
import emailInboundRouter from "./routes/emailInbound";
import { runReminderCheck } from "./jobs/reminders";
import { runWeeklyDigest } from "./jobs/weeklyDigest";

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

app.use("/auth", authRouter);
app.use("/items", itemsRouter);
app.use("/users", usersRouter);
app.use("/integrations/google", googleIntegrationRouter);
app.use("/settings", settingsRouter);
app.use("/api/v1", apiV1Router);
app.use("/review", reviewRouter);
app.use("/integrations/email", emailInboundRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

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
