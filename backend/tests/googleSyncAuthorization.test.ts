import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("google calendar sync authorization", () => {
  it("returns 403 when syncing an item belonging to another (non-owner) user", async () => {
    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const ownerCookie = owner.headers["set-cookie"];

    const otherMember = await request(app)
      .post("/auth/register")
      .send({ email: "outsider@test.com", password: "password123", name: "Outsider" });
    const outsiderCookie = otherMember.headers["set-cookie"];

    // A second, unrelated member — not the owner and not involved with the item at all.
    const bystander = await request(app)
      .post("/auth/register")
      .send({ email: "bystander@test.com", password: "password123", name: "Bystander" });
    const bystanderCookie = bystander.headers["set-cookie"];

    const item = await request(app)
      .post("/items")
      .set("Cookie", outsiderCookie)
      .send({ title: "Privates Item", dueDate: "2030-01-01T10:00:00.000Z" });
    expect(item.status).toBe(201);

    const res = await request(app)
      .post(`/integrations/google/sync/${item.body.id}`)
      .set("Cookie", bystanderCookie);
    expect(res.status).toBe(403);
  });

  it("returns 404 when syncing a non-existent item", async () => {
    const owner = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    const ownerCookie = owner.headers["set-cookie"];

    const res = await request(app)
      .post("/integrations/google/sync/does-not-exist")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(404);
  });
});
