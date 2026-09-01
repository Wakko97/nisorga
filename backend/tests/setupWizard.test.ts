import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

describe("setup wizard", () => {
  beforeEach(async () => {
    // The global test setup marks AppState as initialized so ordinary
    // register/login tests work unaffected. The wizard itself needs to
    // start from the not-yet-initialized state.
    await prisma.appState.update({ where: { id: 1 }, data: { initialized: false } });
  });

  it("GET /setup/status reports initialized and env booleans without leaking secret values", async () => {
    const res = await request(app).get("/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.initialized).toBe(false);
    expect(typeof res.body.env.smtpConfigured).toBe("boolean");
    expect(typeof res.body.env.googleConfigured).toBe("boolean");
    expect(typeof res.body.env.emailInboundConfigured).toBe("boolean");
    expect(JSON.stringify(res.body)).not.toContain(process.env.JWT_SECRET);
  });

  it("POST /setup/init creates the OWNER and flips initialized to true; a second call is 409", async () => {
    const first = await request(app)
      .post("/setup/init")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    expect(first.status).toBe(201);
    expect(first.body.role).toBe("OWNER");
    expect(first.headers["set-cookie"]).toBeDefined();

    const status = await request(app).get("/setup/status");
    expect(status.body.initialized).toBe(true);

    const second = await request(app)
      .post("/setup/init")
      .send({ email: "someone-else@test.com", password: "password123", name: "Someone" });
    expect(second.status).toBe(409);

    // Only one owner was created.
    const owners = await prisma.user.count({ where: { role: "OWNER" } });
    expect(owners).toBe(1);
  });

  it("after setup/init, self-registration via /auth/register produces a MEMBER, never an OWNER", async () => {
    await request(app)
      .post("/setup/init")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });

    const member = await request(app)
      .post("/auth/register")
      .send({ email: "member@test.com", password: "password123", name: "Member" });
    expect(member.status).toBe(201);
    expect(member.body.role).toBe("MEMBER");
  });

  it("blocks self-registration entirely before setup/init has run", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "toosoon@test.com", password: "password123", name: "Too Soon" });
    expect(res.status).toBe(403);
  });
});
