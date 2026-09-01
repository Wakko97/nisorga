import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth } from "../middleware/auth";
import { rotateRefreshToken, revokeRefreshToken } from "../lib/refreshToken";
import { sendEmail } from "../lib/mailer";
import { issueSessionCookies, clearSessionCookies, ACCESS_COOKIE_OPTS, REFRESH_COOKIE_OPTS } from "../lib/session";
import { getWaitingReminderDays } from "../lib/appConfig";
import { encrypt, decrypt } from "../lib/crypto";
import {
  generateTotpSecret,
  generateTotpQrCodeDataUrl,
  verifyTotpToken,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
} from "../lib/twoFactor";

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

// Brute-force protection on the second login step (TOTP/backup code) - a
// 6-digit TOTP code has only 10^6 possibilities, so this needs its own
// tight limit independent of loginRateLimit above (which is keyed on
// email+password attempts, not this step).
const twoFactorVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.tempToken ?? "")}`,
  message: { error: "Too many attempts, please try again later." },
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const TWO_FACTOR_PENDING_TTL = "5m";

// Short-lived, tamper-proof token binding the second login step to a
// specific user who already proved their password - same pattern as
// lib/google.ts's OAuth state token. Deliberately NOT a session cookie:
// it must expire quickly and prove nothing beyond "this request already
// passed step 1 of login for this user".
function signTwoFactorPendingToken(userId: string): string {
  return jwt.sign({ uid: userId, purpose: "2fa-pending" }, process.env.JWT_SECRET!, {
    expiresIn: TWO_FACTOR_PENDING_TTL,
  });
}

function verifyTwoFactorPendingToken(token: string): string {
  const payload = jwt.verify(token, process.env.JWT_SECRET!) as { uid: string; purpose: string };
  if (payload.purpose !== "2fa-pending") throw new Error("Wrong token purpose");
  return payload.uid;
}

// Split in two so the token itself is always persisted before the caller
// moves on, even when the actual send is fire-and-forget (see /register
// below): a caller checking the DB right after must never race the write.
async function issueEmailVerificationToken(userId: string): Promise<string> {
  const verifyToken = crypto.randomUUID();
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifyToken: verifyToken, emailVerifyExpiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS) },
  });
  return verifyToken;
}

async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const verifyToken = await issueEmailVerificationToken(user.id);
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

  // The token must be persisted before we respond (a client polling right
  // after registration must never race this write), but actually sending
  // the email is fire-and-forget so a slow/misconfigured mail server
  // doesn't delay the response.
  const verifyToken = await issueEmailVerificationToken(user.id);
  const link = `${FRONTEND_URL}/verify-email?token=${verifyToken}`;
  sendEmail(
    user.email,
    "Bitte bestätige deine E-Mail-Adresse",
    `<p>Hallo ${user.name},</p><p>bitte bestätige deine E-Mail-Adresse: <a href="${link}">${link}</a></p><p>Der Link ist 24 Stunden gültig.</p>`
  ).catch((err) => console.error("Failed to send verification email:", err));

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified });
});

router.post("/login", loginRateLimit, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  if (user.twoFactorEnabled) {
    // Password was correct, but that alone isn't enough to issue a
    // session - hand back a short-lived token identifying who passed step
    // 1, to be presented alongside a TOTP/backup code at
    // POST /auth/2fa/verify-login.
    return res.json({ twoFactorRequired: true, tempToken: signTwoFactorPendingToken(user.id) });
  }

  await issueSessionCookies(res, user);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified });
});

// Step 2 of login when 2FA is enabled: presents the tempToken from
// POST /login plus either a 6-digit TOTP code or a backup code.
router.post("/2fa/verify-login", twoFactorVerifyRateLimit, async (req, res) => {
  const { tempToken, token, backupCode } = req.body ?? {};
  if (!tempToken || (!token && !backupCode)) {
    return res.status(400).json({ error: "tempToken and either token or backupCode are required" });
  }

  let userId: string;
  try {
    userId = verifyTwoFactorPendingToken(String(tempToken));
  } catch {
    return res.status(401).json({ error: "Invalid or expired login attempt, please log in again" });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecretEnc) {
    return res.status(401).json({ error: "Invalid or expired login attempt, please log in again" });
  }

  if (token) {
    const valid = await verifyTotpToken(decrypt(user.twoFactorSecretEnc), String(token));
    if (!valid) return res.status(401).json({ error: "Invalid code" });
  } else {
    const { matched, remaining } = await consumeBackupCode(user.twoFactorBackupCodeHashes, String(backupCode));
    if (!matched) return res.status(401).json({ error: "Invalid backup code" });
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorBackupCodeHashes: remaining } });
  }

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
    select: { id: true, email: true, name: true, role: true, emailVerified: true, twoFactorEnabled: true },
  });
  res.json({ ...user, waitingReminderDays: await getWaitingReminderDays() });
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

// Two-factor authentication management (all require an existing session -
// this is not the login-time verification, see POST /2fa/verify-login).

// Generates a new (unconfirmed) TOTP secret and its QR code. Overwrites any
// previous pending secret - calling /setup again before /enable just
// restarts setup. Has no effect on login until /enable succeeds.
router.post("/2fa/setup", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecretEnc: encrypt(secret) } });

  const qrCodeDataUrl = await generateTotpQrCodeDataUrl(user.email, secret);
  res.json({ secret, qrCodeDataUrl });
});

// Confirms possession of the secret from /setup and turns 2FA on. Returns
// the backup codes in plaintext - the only time they're ever shown.
router.post("/2fa/enable", requireAuth, async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ error: "token is required" });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.twoFactorSecretEnc) return res.status(400).json({ error: "Call /2fa/setup first" });
  if (user.twoFactorEnabled) return res.status(400).json({ error: "2FA is already enabled" });

  const valid = await verifyTotpToken(decrypt(user.twoFactorSecretEnc), String(token));
  if (!valid) return res.status(401).json({ error: "Invalid code" });

  const backupCodes = generateBackupCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: true, twoFactorBackupCodeHashes: await hashBackupCodes(backupCodes) },
  });

  res.json({ ok: true, backupCodes });
});

// Re-authentication (password) required: this is a security-lowering
// action, so a hijacked-but-unattended session alone shouldn't be enough.
router.post("/2fa/disable", requireAuth, async (req, res) => {
  const { password } = req.body ?? {};
  if (!password) return res.status(400).json({ error: "password is required" });

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid password" });

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorBackupCodeHashes: [] },
  });
  res.json({ ok: true });
});

export default router;
