import "dotenv/config";
import { beforeEach } from "vitest";
import { prisma } from "../src/lib/prisma";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.EMAIL_INBOUND_SECRET = process.env.EMAIL_INBOUND_SECRET || "test-inbound-secret";
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
});
