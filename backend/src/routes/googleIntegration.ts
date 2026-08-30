import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { createOAuthClient, getAuthorizedClientForUser, GOOGLE_SCOPES } from "../lib/google";
import { google } from "googleapis";

const router = Router();
router.use(requireAuth);

router.get("/auth-url", (req, res) => {
  const client = createOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state: req.user!.id,
  });
  res.json({ url });
});

// Note: Google redirects the browser here directly, so this route cannot go
// through requireAuth (no cookie context guaranteed cross-site); we use the
// `state` param (set to the user id above) to know who is completing the flow.
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send("Missing code or state");

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(String(code));

    await prisma.googleAccount.upsert({
      where: { userId: String(state) },
      create: {
        userId: String(state),
        accessToken: tokens.access_token ?? "",
        refreshToken: tokens.refresh_token ?? "",
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      update: {
        accessToken: tokens.access_token ?? undefined,
        refreshToken: tokens.refresh_token ?? undefined,
        expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendUrl}/settings?google=connected`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontendUrl}/settings?google=error`);
  }
});

router.get("/status", async (req, res) => {
  const account = await prisma.googleAccount.findUnique({ where: { userId: req.user!.id } });
  res.json({ connected: !!account });
});

router.post("/sync/:itemId", async (req, res) => {
  const user = req.user!;
  const item = await prisma.item.findUnique({ where: { id: req.params.itemId } });
  if (!item) return res.status(404).json({ error: "Item not found" });
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
