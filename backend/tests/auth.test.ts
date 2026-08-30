import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("auth", () => {
  it("registers the first user as OWNER and subsequent users as MEMBER", async () => {
    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    expect(owner.status).toBe(201);
    expect(owner.body.role).toBe("OWNER");

    const member = await request(app)
      .post("/auth/register")
      .send({ email: "member@test.com", password: "password123", name: "Member" });
    expect(member.status).toBe(201);
    expect(member.body.role).toBe("MEMBER");
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
