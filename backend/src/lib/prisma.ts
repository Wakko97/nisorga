import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Fields safe to expose for a related user (excludes passwordHash, emailInboundToken). */
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} as const;
