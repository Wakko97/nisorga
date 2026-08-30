import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth } from "../middleware/auth";
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "../lib/refreshToken";
import { sendEmail } from "../lib/sendgrid";

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

const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 15 * 60 * 1000,
};

// Scoped to /auth (not just /auth/refresh) so it's still sent on /auth/logout,
// which needs it to revoke the token server-side.
const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

async function issueSessionCookies(res: import("express").Response, user: { id: string; email: string; name: string; role: "OWNER" | "MEMBER" }) {
  const accessToken = signToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  res.cookie("token", accessToken, ACCESS_COOKIE_OPTS);
  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);
}

// res.clearCookie forwards every cookie option (including maxAge) to
// Set-Cookie, which Express deprecated — it now always clears immediately
// regardless of maxAge. Strip it so no deprecation warning is logged.
function clearSessionCookies(res: import("express").Response) {
  const { maxAge: _access, ...accessOpts } = ACCESS_COOKIE_OPTS;
  const { maxAge: _refresh, ...refreshOpts } = REFRESH_COOKIE_OPTS;
  res.clearCookie("token", accessOpts);
  res.clearCookie("refreshToken", refreshOpts);
}

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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const userCount = await prisma.user.count();
  const role = userCount === 0 ? "OWNER" : "MEMBER";

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role, emailInboundToken: crypto.randomUUID() },
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
  res.json(user);
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

router.post("/resend-verification", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.emailVerified) return res.status(400).json({ error: "Email already verified" });

  await sendVerificationEmail(user);
  res.json({ ok: true });
});

export default router;
