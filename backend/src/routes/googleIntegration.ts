import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import {
  createOAuthClient,
  getAuthorizedClientForUser,
  GOOGLE_SCOPES,
  signOAuthState,
  verifyOAuthState,
} from "../lib/google";
import { encrypt } from "../lib/crypto";
import { findItemForUser } from "../lib/itemAuthorization";
import { google } from "googleapis";

const router = Router();
router.use(requireAuth);

router.get("/auth-url", async (req, res) => {
  const client = await createOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state: signOAuthState(req.user!.id),
  });
  res.json({ url });
});

// Note: Google redirects the browser here directly, so this route cannot go
// through requireAuth (no cookie context guaranteed cross-site); we use the
// signed `state` param (see lib/google.ts) to know who is completing the
// flow — it's a short-lived JWT, not a raw user id, so it can't be forged
// or replayed against another account (state CSRF).
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  if (!code || !state) return res.status(400).send("Missing code or state");

  let userId: string;
  try {
    userId = verifyOAuthState(String(state)).uid;
  } catch (err) {
    console.error("Google OAuth state verification failed:", err);
    return res.redirect(`${frontendUrl}/settings?google=error`);
  }

  try {
    const client = await createOAuthClient();
    const { tokens } = await client.getToken(String(code));

    // Google only returns a refresh_token on the first consent; on
    // reconnection we must keep the previously stored (encrypted) one.
    const existing = await prisma.googleAccount.findUnique({ where: { userId } });

    await prisma.googleAccount.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: encrypt(tokens.access_token ?? ""),
        refreshToken: encrypt(tokens.refresh_token ?? ""),
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      update: {
        accessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined,
        refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshToken,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    res.redirect(`${frontendUrl}/settings?google=connected`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect(`${frontendUrl}/settings?google=error`);
  }
});

router.get("/status", async (req, res) => {
  const account = await prisma.googleAccount.findUnique({ where: { userId: req.user!.id } });
  res.json({ connected: !!account });
});

router.post("/sync/:itemId", async (req, res) => {
  const user = req.user!;
  const item = await findItemForUser(req.params.itemId, user);
  if (item === null) return res.status(404).json({ error: "Item not found" });
  if (item === "forbidden") return res.status(403).json({ error: "Forbidden" });
  if (!item.dueDate) return res.status(400).json({ error: "Item has no dueDate to sync" });

  const client = await getAuthorizedClientForUser(user.id);
  if (!client) return res.status(400).json({ error: "Google Calendar not connected" });

  const calendar = google.calendar({ version: "v3", auth: client });
  const start = item.dueDate;
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const eventBody = {
    summary: item.title,
    description: item.description ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  let eventId = item.googleEventId;
  try {
    if (eventId) {
      await calendar.events.update({ calendarId: "primary", eventId, requestBody: eventBody });
    } else {
      const created = await calendar.events.insert({ calendarId: "primary", requestBody: eventBody });
      eventId = created.data.id ?? null;
    }
  } catch (err: any) {
    // Event may have been deleted on Google's side; recreate it.
    const created = await calendar.events.insert({ calendarId: "primary", requestBody: eventBody });
    eventId = created.data.id ?? null;
  }

  const updated = await prisma.item.update({ where: { id: item.id }, data: { googleEventId: eventId } });
  res.json(updated);
});

export default router;
