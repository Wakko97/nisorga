import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

function getCookie(setCookieHeader: string[], name: string): string {
  const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
  if (!raw) throw new Error(`Cookie ${name} not found in ${JSON.stringify(setCookieHeader)}`);
  return raw.split(";")[0];
}

describe("refresh token rotation", () => {
  it("issues both an access token and a refresh token on register", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("refreshToken="))).toBe(true);
  });

  it("rotates the refresh token and issues a new access token on /auth/refresh", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = registerRes.headers["set-cookie"] as unknown as string[];
    const originalRefresh = getCookie(cookies, "refreshToken");

    const refreshRes = await request(app).post("/auth/refresh").set("Cookie", originalRefresh);
    expect(refreshRes.status).toBe(200);
    const newCookies = refreshRes.headers["set-cookie"] as unknown as string[];
    const newRefresh = getCookie(newCookies, "refreshToken");
    expect(newRefresh).not.toBe(originalRefresh);

    // The new access token must work against a protected route.
    const newAccess = getCookie(newCookies, "token");
    const me = await request(app).get("/auth/me").set("Cookie", newAccess);
    expect(me.status).toBe(200);
  });

  it("rejects reuse of an already-rotated refresh token and revokes the session", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = registerRes.headers["set-cookie"] as unknown as string[];
    const originalRefresh = getCookie(cookies, "refreshToken");

    const firstRefresh = await request(app).post("/auth/refresh").set("Cookie", originalRefresh);
    expect(firstRefresh.status).toBe(200);
    const rotatedCookies = firstRefresh.headers["set-cookie"] as unknown as string[];
    const rotatedRefresh = getCookie(rotatedCookies, "refreshToken");

    // Reusing the original (now-revoked) token must fail...
    const reuse = await request(app).post("/auth/refresh").set("Cookie", originalRefresh);
    expect(reuse.status).toBe(401);

    // ...and, as theft protection, must also revoke the token that replaced it.
    const afterTheft = await request(app).post("/auth/refresh").set("Cookie", rotatedRefresh);
    expect(afterTheft.status).toBe(401);
  });

  it("rejects a missing or garbage refresh token", async () => {
    const res = await request(app).post("/auth/refresh").set("Cookie", "refreshToken=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("revokes the refresh token on logout", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = registerRes.headers["set-cookie"] as unknown as string[];
    const refreshCookie = getCookie(cookies, "refreshToken");

    await request(app).post("/auth/logout").set("Cookie", refreshCookie);

    const afterLogout = await request(app).post("/auth/refresh").set("Cookie", refreshCookie);
    expect(afterLogout.status).toBe(401);
  });
});
