import { Response } from "express";
import { signToken } from "../middleware/auth";
import { issueRefreshToken } from "./refreshToken";

export const ACCESS_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 15 * 60 * 1000,
};

// Scoped to /auth (not just /auth/refresh) so it's still sent on /auth/logout,
// which needs it to revoke the token server-side.
export const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/auth",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export async function issueSessionCookies(
  res: Response,
  user: { id: string; email: string; name: string; role: "OWNER" | "MEMBER" }
) {
  const accessToken = signToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  res.cookie("token", accessToken, ACCESS_COOKIE_OPTS);
  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTS);
}

// res.clearCookie forwards every cookie option (including maxAge) to
// Set-Cookie, which Express deprecated — it now always clears immediately
// regardless of maxAge. Strip it so no deprecation warning is logged.
export function clearSessionCookies(res: Response) {
  const { maxAge: _access, ...accessOpts } = ACCESS_COOKIE_OPTS;
  const { maxAge: _refresh, ...refreshOpts } = REFRESH_COOKIE_OPTS;
  res.clearCookie("token", accessOpts);
  res.clearCookie("refreshToken", refreshOpts);
}
