import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

describe("email verification", () => {
  it("registers a user as unverified", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    expect(res.body.emailVerified).toBe(false);
  });

  it("verifies the email with a valid token", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "owner@test.com" } });
    expect(user.emailVerifyToken).toBeTruthy();

    const res = await request(app).post("/auth/verify-email").send({ token: user.emailVerifyToken });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { email: "owner@test.com" } });
    expect(updated.emailVerified).toBe(true);
    expect(updated.emailVerifyToken).toBeNull();
  });

  it("rejects an unknown or expired verification token", async () => {
    const res = await request(app).post("/auth/verify-email").send({ token: "not-a-real-token" });
    expect(res.status).toBe(400);
  });

  it("lets a logged-in unverified user request a new verification email", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = registerRes.headers["set-cookie"];

    const res = await request(app).post("/auth/resend-verification").set("Cookie", cookies);
    expect(res.status).toBe(200);
  });

  it("rate-limits resend-verification to 3 per hour per user", async () => {
    const registerRes = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const cookies = registerRes.headers["set-cookie"];

    let lastStatus = 0;
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/auth/resend-verification").set("Cookie", cookies);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
