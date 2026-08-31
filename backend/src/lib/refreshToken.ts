import crypto from "crypto";
import { prisma } from "./prisma";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Issues a new refresh token for a user, storing only its hash. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

export type RotateResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/**
 * Rotates a refresh token: the presented token is revoked and, if it was
 * still valid, a fresh one is issued in its place. If a token that was
 * already revoked is presented again, that's a signal of token theft (the
 * legitimate client and an attacker both tried to use it) — every
 * outstanding refresh token for that user is revoked so both sessions are
 * forced to re-authenticate.
 */
export async function rotateRefreshToken(presentedToken: string): Promise<RotateResult> {
  const tokenHash = hashToken(presentedToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) return { ok: false, reason: "invalid" };

  if (existing.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "expired" };
  }

  // Conditional update: only succeeds if this token was still unrevoked at
  // the moment we claim it. If two requests race to rotate the same token
  // (e.g. concurrent /auth/refresh calls, or a stolen+replayed token),
  // exactly one wins this update; the loser falls into the count===0 branch
  // below and is treated as reuse/theft — revoking every outstanding
  // refresh token for the user so both sessions are forced to re-authenticate.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (claimed.count === 0) {
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: "reused" };
  }

  const nextToken = await issueRefreshToken(existing.userId);
  return { ok: true, userId: existing.userId, token: nextToken };
}

/** Revokes a single refresh token (used on logout). */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  const tokenHash = hashToken(presentedToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
