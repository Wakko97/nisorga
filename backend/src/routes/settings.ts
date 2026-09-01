import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { requireAuth, requireOwner } from "../middleware/auth";
import { generateApiKey } from "../lib/apiKey";
import { assertPublicHttpUrl } from "../lib/ssrfGuard";
import { getEmailInboundDomain } from "../lib/mailConfig";
import { encrypt } from "../lib/crypto";
import { getVapidPublicKey } from "../lib/push";

const router = Router();
router.use(requireAuth);

async function inboundAddress(token: string) {
  const domain = await getEmailInboundDomain();
  return `inbox+${token}@${domain}`;
}

// Web push subscriptions - per user, one row per browser/device.
router.get("/push/public-key", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post("/push/subscribe", async (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: "endpoint and keys.{p256dh,auth} are required" });
  }

  // Upsert on endpoint (unique): re-subscribing the same browser just
  // refreshes the row rather than erroring or duplicating it, and also
  // reassigns it if the subscribing user changed (e.g. logout/login as
  // someone else on the same device).
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: req.user!.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId: req.user!.id, p256dh: keys.p256dh, auth: keys.auth },
  });
  res.status(201).json({ ok: true });
});

router.delete("/push/subscribe", async (req, res) => {
  const endpoint = String(req.body?.endpoint ?? req.query.endpoint ?? "");
  if (!endpoint) return res.status(400).json({ error: "endpoint is required" });

  const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
  // Not found, or found but belongs to someone else: either way there is
  // nothing this user is allowed to delete, but unsubscribing an already-
  // gone subscription is not an error from the client's point of view.
  if (!sub || sub.userId !== req.user!.id) return res.json({ ok: true });

  await prisma.pushSubscription.delete({ where: { endpoint } });
  res.json({ ok: true });
});

// Email inbound capture
router.get("/email", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ address: await inboundAddress(user.emailInboundToken) });
});

router.post("/email/regenerate", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { emailInboundToken: crypto.randomUUID() },
  });
  res.json({ address: await inboundAddress(user.emailInboundToken) });
});

// Mail configuration (SMTP send + IMAP receive) — global (one config for
// the whole instance, not per-user), Owner-only. Falls back to SMTP_*/
// IMAP_* env vars when unset here (see lib/mailConfig.ts) so a deployment
// can still be configured entirely via .env without ever touching this.
router.get("/mail", requireOwner, async (req, res) => {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  res.json({
    smtp: {
      host: state?.smtpHost ?? "",
      port: state?.smtpPort ?? Number(process.env.SMTP_PORT || 587),
      secure: state?.smtpHost ? state.smtpSecure : process.env.SMTP_SECURE === "true",
      user: state?.smtpUser ?? "",
      fromEmail: state?.smtpFromEmail ?? "",
      passwordSet: !!state?.smtpPasswordEnc || !!process.env.SMTP_PASSWORD,
    },
    imap: {
      host: state?.imapHost ?? "",
      port: state?.imapPort ?? Number(process.env.IMAP_PORT || 993),
      secure: state?.imapHost ? state.imapSecure : process.env.IMAP_SECURE !== "false",
      user: state?.imapUser ?? "",
      mailbox: state?.imapMailbox ?? "INBOX",
      inboundDomain: state?.emailInboundDomain ?? "",
      passwordSet: !!state?.imapPasswordEnc || !!process.env.IMAP_PASSWORD,
    },
  });
});

router.put("/mail", requireOwner, async (req, res) => {
  const { smtp, imap } = req.body ?? {};
  const data: Record<string, string | number | boolean | null> = {};

  // Password handling: field omitted -> leave the stored value untouched;
  // "" -> explicitly clear it; any other string -> encrypt and store it.
  // This lets the Owner update e.g. just the port without having to
  // re-enter the password every time.
  if (smtp && typeof smtp === "object") {
    if (smtp.host !== undefined) data.smtpHost = smtp.host || null;
    if (smtp.port !== undefined) data.smtpPort = smtp.port ? Number(smtp.port) : null;
    if (smtp.secure !== undefined) data.smtpSecure = !!smtp.secure;
    if (smtp.user !== undefined) data.smtpUser = smtp.user || null;
    if (smtp.fromEmail !== undefined) data.smtpFromEmail = smtp.fromEmail || null;
    if (smtp.password === "") data.smtpPasswordEnc = null;
    else if (smtp.password) data.smtpPasswordEnc = encrypt(String(smtp.password));
  }
  if (imap && typeof imap === "object") {
    if (imap.host !== undefined) data.imapHost = imap.host || null;
    if (imap.port !== undefined) data.imapPort = imap.port ? Number(imap.port) : null;
    if (imap.secure !== undefined) data.imapSecure = !!imap.secure;
    if (imap.user !== undefined) data.imapUser = imap.user || null;
    if (imap.mailbox !== undefined) data.imapMailbox = imap.mailbox || null;
    if (imap.inboundDomain !== undefined) data.emailInboundDomain = imap.inboundDomain || null;
    if (imap.password === "") data.imapPasswordEnc = null;
    else if (imap.password) data.imapPasswordEnc = encrypt(String(imap.password));
  }

  await prisma.appState.update({ where: { id: 1 }, data });
  res.json({ ok: true });
});

// Other app-wide configuration (Google OAuth, delegation reminder
// threshold) — global, Owner-only. Same DB-first/env-fallback pattern as
// /settings/mail; see lib/google.ts and lib/appConfig.ts.
router.get("/app", requireOwner, async (req, res) => {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  res.json({
    google: {
      clientId: state?.googleClientId ?? "",
      redirectUri: state?.googleRedirectUri ?? "",
      secretSet: !!state?.googleClientSecretEnc || !!process.env.GOOGLE_CLIENT_SECRET,
    },
    waitingReminderDays: state?.waitingReminderDays ?? Number(process.env.WAITING_REMINDER_DAYS || 3),
  });
});

router.put("/app", requireOwner, async (req, res) => {
  const { google, waitingReminderDays } = req.body ?? {};
  const data: Record<string, string | number | null> = {};

  if (google && typeof google === "object") {
    if (google.clientId !== undefined) data.googleClientId = google.clientId || null;
    if (google.redirectUri !== undefined) data.googleRedirectUri = google.redirectUri || null;
    if (google.clientSecret === "") data.googleClientSecretEnc = null;
    else if (google.clientSecret) data.googleClientSecretEnc = encrypt(String(google.clientSecret));
  }
  if (waitingReminderDays !== undefined) {
    data.waitingReminderDays = waitingReminderDays === null ? null : Number(waitingReminderDays);
  }

  await prisma.appState.update({ where: { id: 1 }, data });
  res.json({ ok: true });
});

// API keys
router.get("/api-keys", async (req, res) => {
  const keys = await prisma.apiKey.findMany({
    where: { userId: req.user!.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(keys);
});

router.post("/api-keys", async (req, res) => {
  const { label } = req.body ?? {};
  if (!label) return res.status(400).json({ error: "label is required" });

  const { plain, hash } = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { userId: req.user!.id, key: hash, label },
  });
  // Plaintext key is returned only once; only the hash is persisted.
  res.status(201).json({ id: key.id, label: key.label, createdAt: key.createdAt, key: plain });
});

router.delete("/api-keys/:id", async (req, res) => {
  const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!key || key.userId !== req.user!.id) return res.status(404).json({ error: "Not found" });
  await prisma.apiKey.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Webhooks
router.get("/webhooks", async (req, res) => {
  const hooks = await prisma.webhookSubscription.findMany({ where: { userId: req.user!.id } });
  res.json(hooks);
});

router.post("/webhooks", async (req, res) => {
  const { url, events } = req.body ?? {};
  if (!url || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "url and non-empty events[] are required" });
  }

  try {
    await assertPublicHttpUrl(url);
  } catch {
    return res.status(400).json({ error: "URL not allowed" });
  }

  const hook = await prisma.webhookSubscription.create({
    data: { userId: req.user!.id, url, events },
  });
  res.status(201).json(hook);
});

router.delete("/webhooks/:id", async (req, res) => {
  const hook = await prisma.webhookSubscription.findUnique({ where: { id: req.params.id } });
  if (!hook || hook.userId !== req.user!.id) return res.status(404).json({ error: "Not found" });
  await prisma.webhookSubscription.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

export default router;
