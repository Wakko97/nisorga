import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { issueSessionCookies } from "../lib/session";
import { getSmtpConfig, getImapConfig } from "../lib/mailConfig";
import { isGoogleConfigured } from "../lib/google";

const router = Router();

// GET /setup/status — no auth. Lets the frontend decide whether to show the
// setup wizard, and which integrations still need configuring (either via
// env vars or, once an Owner exists, the Settings UI). Only booleans are
// exposed, never the underlying secret values.
router.get("/status", async (_req, res) => {
  const appState = await prisma.appState.findUnique({ where: { id: 1 } });
  const [smtp, imap, googleConfigured] = await Promise.all([getSmtpConfig(), getImapConfig(), isGoogleConfigured()]);
  res.json({
    initialized: !!appState?.initialized,
    env: {
      smtpConfigured: !!smtp,
      googleConfigured,
      emailInboundConfigured: !!imap,
    },
  });
});

// POST /setup/init — no auth (this IS the bootstrap step). Creates the
// OWNER account exactly once, atomically.
router.post("/init", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password and name are required" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  // Claim initialization atomically: only one concurrent caller can flip
  // this row from false -> true. Everyone else gets 409 immediately,
  // without ever touching user creation.
  const claimed = await prisma.appState.updateMany({
    where: { id: 1, initialized: false },
    data: { initialized: true },
  });
  if (claimed.count === 0) {
    return res.status(409).json({ error: "Already initialized" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  try {
    // Practically the email check should never fail here (setup runs before
    // self-registration is possible), but if it does, prisma.user.create
    // throws on the unique constraint and we fall into the catch below —
    // which rolls the AppState claim back so setup stays retryable.
    user = await prisma.user.create({
      data: { email, passwordHash, name, role: "OWNER", emailInboundToken: crypto.randomUUID() },
    });
  } catch (err: any) {
    // Roll back the claim so this doesn't leave the app permanently stuck
    // "initialized" with no owner account.
    await prisma.appState.update({ where: { id: 1 }, data: { initialized: false } });
    if (err?.code === "P2002") return res.status(409).json({ error: "Email already registered" });
    console.error("Setup init failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }

  await issueSessionCookies(res, user);
  return res
    .status(201)
    .json({ id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified });
});

export default router;
