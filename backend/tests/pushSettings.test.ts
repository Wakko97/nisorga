import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

async function registerAndLogin(email: string, name: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  return { cookie: res.headers["set-cookie"], id: res.body.id };
}

describe("Settings: /settings/push", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /settings/push/public-key returns null when unconfigured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    const res = await request(app).get("/settings/push/public-key").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBeNull();
  });

  it("POST /settings/push/subscribe requires endpoint and keys", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    const res = await request(app).post("/settings/push/subscribe").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
  });

  it("POST /settings/push/subscribe creates a subscription for the current user", async () => {
    const { cookie, id } = await registerAndLogin("owner@test.com", "Owner");
    const res = await request(app)
      .post("/settings/push/subscribe")
      .set("Cookie", cookie)
      .send({ endpoint: "https://push.example.com/x", keys: { p256dh: "p1", auth: "a1" } });
    expect(res.status).toBe(201);

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://push.example.com/x" } });
    expect(sub).toMatchObject({ userId: id, p256dh: "p1", auth: "a1" });
  });

  it("POST /settings/push/subscribe re-subscribing the same endpoint upserts rather than erroring", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    const body = { endpoint: "https://push.example.com/y", keys: { p256dh: "p1", auth: "a1" } };

    const first = await request(app).post("/settings/push/subscribe").set("Cookie", cookie).send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/settings/push/subscribe")
      .set("Cookie", cookie)
      .send({ ...body, keys: { p256dh: "p2", auth: "a2" } });
    expect(second.status).toBe(201);

    const subs = await prisma.pushSubscription.findMany({ where: { endpoint: "https://push.example.com/y" } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ p256dh: "p2", auth: "a2" });
  });

  it("DELETE /settings/push/subscribe removes the current user's own subscription", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await request(app)
      .post("/settings/push/subscribe")
      .set("Cookie", cookie)
      .send({ endpoint: "https://push.example.com/z", keys: { p256dh: "p1", auth: "a1" } });

    const res = await request(app)
      .delete("/settings/push/subscribe")
      .set("Cookie", cookie)
      .send({ endpoint: "https://push.example.com/z" });
    expect(res.status).toBe(200);

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://push.example.com/z" } });
    expect(sub).toBeNull();
  });

  it("DELETE /settings/push/subscribe does not remove another user's subscription", async () => {
    const owner = await registerAndLogin("owner@test.com", "Owner");
    await request(app)
      .post("/settings/push/subscribe")
      .set("Cookie", owner.cookie)
      .send({ endpoint: "https://push.example.com/protected", keys: { p256dh: "p1", auth: "a1" } });

    const member = await registerAndLogin("member@test.com", "Member");
    const res = await request(app)
      .delete("/settings/push/subscribe")
      .set("Cookie", member.cookie)
      .send({ endpoint: "https://push.example.com/protected" });
    expect(res.status).toBe(200);

    const sub = await prisma.pushSubscription.findUnique({ where: { endpoint: "https://push.example.com/protected" } });
    expect(sub).not.toBeNull();
  });
});
