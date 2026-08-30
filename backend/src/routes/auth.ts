import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth } from "../middleware/auth";

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password and name are required" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const userCount = await prisma.user.count();
  const role = userCount === 0 ? "OWNER" : "MEMBER";

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name, role, emailInboundToken: crypto.randomUUID() },
  });

  const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
  res.cookie("token", token, COOKIE_OPTS);
  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
  res.cookie("token", token, COOKIE_OPTS);
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token", { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
