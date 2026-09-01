import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import * as webhooksLib from "../src/lib/webhooks";
import { createItemFromInboundEmail } from "../src/lib/inboundEmail";

describe("createItemFromInboundEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires webhooks and creates an INBOX idea with source=EMAIL for a valid token", async () => {
    const fireWebhooksSpy = vi.spyOn(webhooksLib, "fireWebhooks").mockResolvedValue(undefined);

    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const ownerCookie = owner.headers["set-cookie"];

    const emailSettings = await request(app).get("/settings/email").set("Cookie", ownerCookie);
    const address: string = emailSettings.body.address;

    const item = await createItemFromInboundEmail({
      to: address,
      subject: "Idee per Mail",
      text: "Inhalt der Mail",
    });

    expect(item).not.toBeNull();
    expect(item!.source).toBe("EMAIL");
    expect(item!.title).toBe("Idee per Mail");
    expect(fireWebhooksSpy).toHaveBeenCalledWith(
      owner.body.id,
      "item.created",
      expect.objectContaining({ source: "EMAIL" }),
    );

    const items = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(items.body).toHaveLength(1);
    expect(items.body[0].source).toBe("EMAIL");
    expect(items.body[0].title).toBe("Idee per Mail");
  });

  it("returns null when the 'to' address has no routing token", async () => {
    const item = await createItemFromInboundEmail({
      to: "inbox@inbound.example.com",
      subject: "Test",
      text: "Body",
    });
    expect(item).toBeNull();
  });

  it("returns null for an unknown inbound token", async () => {
    const item = await createItemFromInboundEmail({
      to: "inbox+not-a-real-token@inbound.example.com",
      subject: "Test",
      text: "Body",
    });
    expect(item).toBeNull();
  });
});
