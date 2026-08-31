import { google } from "googleapis";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./prisma";
import { encrypt, decrypt } from "./crypto";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

const OAUTH_STATE_TTL = "10m";

/**
 * Signs a short-lived, tamper-proof `state` token binding the OAuth flow to
 * a specific user. Prevents an attacker from crafting a callback request
 * that links their own Google account to someone else's (state CSRF).
 */
export function signOAuthState(userId: string): string {
  return jwt.sign({ uid: userId, nonce: crypto.randomUUID() }, process.env.JWT_SECRET!, {
    expiresIn: OAUTH_STATE_TTL,
  });
}

/** Verifies a `state` token produced by signOAuthState. Throws if invalid/expired/tampered. */
export function verifyOAuthState(state: string): { uid: string } {
  return jwt.verify(state, process.env.JWT_SECRET!) as { uid: string };
}

/**
 * Resolves Google OAuth client credentials with the Owner-managed Settings
 * (AppState, see GET/PUT /settings/app) taking priority over the matching
 * GOOGLE_* env var, falling back field-by-field - same pattern as
 * lib/mailConfig.ts.
 */
export async function createOAuthClient() {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  return new google.auth.OAuth2(
    state?.googleClientId || process.env.GOOGLE_CLIENT_ID,
    state?.googleClientSecretEnc ? decrypt(state.googleClientSecretEnc) : process.env.GOOGLE_CLIENT_SECRET,
    state?.googleRedirectUri || process.env.GOOGLE_REDIRECT_URI
  );
}

/** Returns true once Google OAuth is configured, via Settings or env vars. */
export async function isGoogleConfigured(): Promise<boolean> {
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  const clientId = state?.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = state?.googleClientSecretEnc || process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Returns an OAuth2 client authenticated for the given user, refreshing
 * the access token via the stored refresh token if it has expired.
 */
export async function getAuthorizedClientForUser(userId: string) {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const client = await createOAuthClient();
  client.setCredentials({
    access_token: decrypt(account.accessToken),
    refresh_token: decrypt(account.refreshToken),
    expiry_date: account.expiryDate ? account.expiryDate.getTime() : undefined,
  });

  const isExpired = !account.expiryDate || account.expiryDate.getTime() < Date.now() + 60_000;
  if (isExpired) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await prisma.googleAccount.update({
      where: { userId },
      data: {
        accessToken: credentials.access_token ? encrypt(credentials.access_token) : account.accessToken,
        expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      },
    });
  }

  return client;
}
