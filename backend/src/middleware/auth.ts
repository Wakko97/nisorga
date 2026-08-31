import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "MEMBER";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

// Short-lived on purpose: a stolen access token is only useful for a few
// minutes. Long-lived sessions are carried by the rotating refresh token
// (see lib/refreshToken.ts and POST /auth/refresh) instead.
export function signToken(user: AuthUser) {
  return jwt.sign({ id: user.id }, JWT_SECRET!, { expiresIn: "15m" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = jwt.verify(token, JWT_SECRET!) as { id: string };
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ error: "Not authenticated" });

    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Not authenticated" });
  }
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "OWNER") return res.status(403).json({ error: "Owner only" });
  next();
}
