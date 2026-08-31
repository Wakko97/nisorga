import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import * as webhooksLib from "../src/lib/webhooks";

describe("email inbound", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires webhooks for an item created via inbound email", async () => {
    const fireWebhooksSpy = vi.spyOn(webhooksLib, "fireWebhooks").mockResolvedValue(undefined);

    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const ownerCookie = owner.headers["set-cookie"];

    const emailSettings = await request(app).get("/settings/email").set("Cookie", ownerCookie);
    const address: string = emailSettings.body.address;

    const res = await request(app)
      .post(`/integrations/email/inbound?secret=${process.env.EMAIL_INBOUND_SECRET}`)
      .field("to", address)
      .field("subject", "Idee per Mail")
      .field("text", "Inhalt der Mail");
    expect(res.status).toBe(201);

    expect(fireWebhooksSpy).toHaveBeenCalledWith(owner.body.id, "item.created", expect.objectContaining({ source: "EMAIL" }));
  });
});

describe("email inbound (legacy)", () => {
  it("rejects requests with a missing or wrong shared secret", async () => {
    const res = await request(app)
      .post("/integrations/email/inbound?secret=wrong")
      .field("to", "inbox+doesnotmatter@inbound.example.com")
      .field("subject", "Test")
      .field("text", "Body");
    expect(res.status).toBe(401);
  });

  it("creates an INBOX idea with source=EMAIL for a valid token", async () => {
    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const ownerCookie = owner.headers["set-cookie"];

    const emailSettings = await request(app).get("/settings/email").set("Cookie", ownerCookie);
    const address: string = emailSettings.body.address;

    const res = await request(app)
      .post(`/integrations/email/inbound?secret=${process.env.EMAIL_INBOUND_SECRET}`)
      .field("to", address)
      .field("subject", "Idee per Mail")
      .field("text", "Inhalt der Mail");
    expect(res.status).toBe(201);

    const items = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(items.body).toHaveLength(1);
    expect(items.body[0].source).toBe("EMAIL");
    expect(items.body[0].title).toBe("Idee per Mail");
  });

  it("returns 404 for an unknown inbound token", async () => {
    const res = await request(app)
      .post(`/integrations/email/inbound?secret=${process.env.EMAIL_INBOUND_SECRET}`)
      .field("to", "inbox+not-a-real-token@inbound.example.com")
      .field("subject", "Test")
      .field("text", "Body");
    expect(res.status).toBe(404);
  });
});
