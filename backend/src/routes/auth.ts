import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth } from "../middleware/auth";
import { rotateRefreshToken, revokeRefreshToken } from "../lib/refreshToken";
import { sendEmail } from "../lib/mailer";
import { issueSessionCookies, clearSessionCookies, ACCESS_COOKIE_OPTS, REFRESH_COOKIE_OPTS } from "../lib/session";

const router = Router();

// Brute-force protection: keyed by IP + attempted email so one attacker
// can't lock out a real user, and one user's failed attempts elsewhere
// don't throttle other accounts sharing their network.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email ?? "").toLowerCase()}`,
  message: { error: "Too many login attempts, please try again later." },
});

// Prevents abusing resend-verification as an email bomb / spam vector.
// Keyed by the authenticated user's id (route is behind requireAuth).
const resendVerificationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: { error: "Too many verification emails requested, please try again later." },
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const verifyToken = crypto.randomUUID();
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyToken: verifyToken, emailVerifyExpiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS) },
  });
  const link = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
  await sendEmail(
    user.email,
    "Bitte bestätige deine E-Mail-Adresse",
    `<p>Hallo ${user.name},</p><p>bitte bestätige deine E-Mail-Adresse: <a href="${link}">${link}</a></p><p>Der Link ist 24 Stunden gültig.</p>`
  );
}

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password and name are required" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  // Self-registration only opens once the setup wizard has created the
  // OWNER account (see routes/setup.ts). This also removes the old
  // "first registered user becomes OWNER" race.
  const appState = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!appState?.initialized) {
    return res.status(403).json({ error: "Setup not completed" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role: "MEMBER", emailInboundToken: crypto.randomUUID() },
  });

  await issueSessionCookies(res, user);
  sendVerificationEmail(user).catch((err) => console.error("Failed to send verification email:", err));

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified });
});

router.post("/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  await issueSessionCookies(res, user);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified });
});

// Rotates the refresh token and issues a fresh short-lived access token.
// The frontend calls this whenever a request comes back 401 with an
// expired access token, transparently to the user.
router.post("/refresh", async (req, res) => {
  const presented = req.cookies?.refreshToken;
  if (!presented) return res.status(401).json({ error: "No refresh token" });

  const result = await rotateRefreshToken(presented);
  if (!result.ok) {
    clearSessionCookies(res);
    return res.status(401).json({ error: `Refresh token ${result.reason}` });
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) {
    clearSessionCookies(res);
    return res.status(401).json({ error: "User no longer exists" });
  }

  const accessToken = signToken(user);
  res.cookie("token", accessToken, ACCESS_COOKIE_OPTS);
  res.cookie("refreshToken", result.token, REFRESH_COOKIE_OPTS);
  res.json({ ok: true });
});

router.post("/logout", async (req, res) => {
  const presented = req.cookies?.refreshToken;
  if (presented) await revokeRefreshToken(presented);
  clearSessionCookies(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, role: true, emailVerified: true },
  });
  res.json({ ...user, waitingReminderDays: Number(process.env.WAITING_REMINDER_DAYS || 3) });
});

router.post("/verify-email", async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ error: "token is required" });

  const user = await prisma.user.findUnique({ where: { emailVerifyToken: String(token) } });
  if (!user || !user.emailVerifyExpiresAt || user.emailVerifyExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired verification link" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpiresAt: null },
  });
  res.json({ ok: true });
});

router.post("/resend-verification", requireAuth, resendVerificationRateLimit, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.emailVerified) return res.status(400).json({ error: "Email already verified" });

  await sendVerificationEmail(user);
  res.json({ ok: true });
});

export default router;
