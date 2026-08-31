import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { hashApiKey } from "../lib/apiKey";
import { AuthUser } from "./auth";

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing Bearer API key" });
  }
  const plain = header.slice("Bearer ".length).trim();
  const hash = hashApiKey(plain);

  const apiKey = await prisma.apiKey.findUnique({ where: { key: hash }, include: { user: true } });
  if (!apiKey) return res.status(401).json({ error: "Invalid API key" });

  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  const user = apiKey.user;
  const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  req.user = authUser;
  next();
}
