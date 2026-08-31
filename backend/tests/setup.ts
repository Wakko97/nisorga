import "dotenv/config";
import { beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY =
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "0".repeat(64);

// Truncate all app tables between tests so each test starts from a clean slate.
beforeEach(async () => {
  await prisma.comment.deleteMany();
  await prisma.item.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.googleAccount.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  // Most tests exercise the app as if the setup wizard already ran (self
  // registration open). Tests covering the wizard itself explicitly flip
  // this back to false. Mail settings are reset too, so a test that
  // configures them (Settings /mail) can't leak into an unrelated test
  // that expects env-var fallback behavior.
  await prisma.appState.upsert({
    where: { id: 1 },
    update: {
      initialized: true,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: false,
      smtpUser: null,
      smtpPasswordEnc: null,
      smtpFromEmail: null,
      imapHost: null,
      imapPort: null,
      imapSecure: true,
      imapUser: null,
      imapPasswordEnc: null,
      imapMailbox: null,
      emailInboundDomain: null,
      googleClientId: null,
      googleClientSecretEnc: null,
      googleRedirectUri: null,
      waitingReminderDays: null,
    },
    create: { id: 1, initialized: true },
  });
});
