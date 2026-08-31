import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

describe("auth", () => {
  it("registers every self-registered user as MEMBER (OWNER is created only via the setup wizard)", async () => {
    const first = await request(app)
      .post("/auth/register")
      .send({ email: "first@test.com", password: "password123", name: "First" });
    expect(first.status).toBe(201);
    expect(first.body.role).toBe("MEMBER");

    const second = await request(app)
      .post("/auth/register")
      .send({ email: "second@test.com", password: "password123", name: "Second" });
    expect(second.status).toBe(201);
    expect(second.body.role).toBe("MEMBER");
  });

  it("rejects registration before the setup wizard has run", async () => {
    await prisma.appState.update({ where: { id: 1 }, data: { initialized: false } });
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "toosoon@test.com", password: "password123", name: "Too Soon" });
    expect(res.status).toBe(403);
  });

  it("never returns passwordHash or emailInboundToken from register/login/me", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "secret@test.com", password: "password123", name: "Secret" });
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.emailInboundToken).toBeUndefined();

    const cookie = res.headers["set-cookie"];
    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.passwordHash).toBeUndefined();
  });

  it("rejects login with wrong password", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "wrongpw@test.com", password: "password123", name: "User" });

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "wrongpw@test.com", password: "not-the-password" });
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated failed logins for the same email", async () => {
    await request(app)
      .post("/auth/register")
      .send({ email: "bruteforce@test.com", password: "password123", name: "User" });

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "bruteforce@test.com", password: "wrong-password" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
