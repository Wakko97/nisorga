import { google } from "googleapis";
import { prisma } from "./prisma";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Returns an OAuth2 client authenticated for the given user, refreshing
 * the access token via the stored refresh token if it has expired.
 */
export async function getAuthorizedClientForUser(userId: string) {
  const account = await prisma.googleAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.expiryDate ? account.expiryDate.getTime() : undefined,
  });

  const isExpired = !account.expiryDate || account.expiryDate.getTime() < Date.now() + 60_000;
  if (isExpired) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    await prisma.googleAccount.update({
      where: { userId },
      data: {
        accessToken: credentials.access_token ?? account.accessToken,
        expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      },
    });
  }

  return client;
}
