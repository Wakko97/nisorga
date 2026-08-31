import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";

async function registerAndLogin(email: string, name: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  return res.headers["set-cookie"];
}

describe("items", () => {
  let ownerCookie: string[];
  let memberCookie: string[];

  beforeEach(async () => {
    ownerCookie = await registerAndLogin("owner@test.com", "Owner");
    memberCookie = await registerAndLogin("member@test.com", "Member");
  });

  it("creates an item with only a title (fast capture)", async () => {
    const res = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Neue Idee" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("IDEA");
    expect(res.body.status).toBe("INBOX");
  });

  it("converts an idea into a task", async () => {
    const created = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Idee" });
    const res = await request(app).post(`/items/${created.body.id}/convert`).set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("TASK");
    expect(res.body.status).toBe("TODO");
  });

  it("sets and clears waitingSince when status toggles to/from WAITING", async () => {
    const created = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Delegiert" });

    const waiting = await request(app)
      .patch(`/items/${created.body.id}`)
      .set("Cookie", ownerCookie)
      .send({ status: "WAITING" });
    expect(waiting.body.status).toBe("WAITING");
    expect(waiting.body.waitingSince).not.toBeNull();

    const resolved = await request(app)
      .patch(`/items/${created.body.id}`)
      .set("Cookie", ownerCookie)
      .send({ status: "DONE" });
    expect(resolved.body.waitingSince).toBeNull();
  });

  it("hides items a member did not create or get assigned from that member's list", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Owner-only Idee" });

    const memberItems = await request(app).get("/items").set("Cookie", memberCookie);
    expect(memberItems.body).toHaveLength(0);

    const ownerItems = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(ownerItems.body).toHaveLength(1);
  });

  it("lets a member see items assigned to them by the owner", async () => {
    const memberMe = await request(app).get("/auth/me").set("Cookie", memberCookie);
    await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Für Assistenz", assignedToId: memberMe.body.id });

    const memberItems = await request(app).get("/items").set("Cookie", memberCookie);
    expect(memberItems.body).toHaveLength(1);
  });

  it("never leaks passwordHash via the createdBy/assignedTo relations", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Idee" });
    const res = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(res.body[0].createdBy.passwordHash).toBeUndefined();
    expect(res.body[0].createdBy.emailInboundToken).toBeUndefined();
  });

  it("rejects requests without a valid session", async () => {
    const res = await request(app).get("/items");
    expect(res.status).toBe(401);
  });

  it("sets waitingSince immediately when an item is created with status=WAITING", async () => {
    const res = await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Direkt wartend", status: "WAITING" });
    expect(res.status).toBe(201);
    expect(res.body.waitingSince).not.toBeNull();
  });

  it("leaves waitingSince null when created with a non-WAITING status", async () => {
    const res = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Neue Idee" });
    expect(res.body.waitingSince).toBeNull();
  });

  it("rejects an invalid `type` query filter with 400 instead of crashing", async () => {
    const res = await request(app).get("/items?type=bogus").set("Cookie", ownerCookie);
    expect(res.status).toBe(400);
  });

  it("rejects an invalid `status` query filter with 400 instead of crashing", async () => {
    const res = await request(app).get("/items?status=bogus").set("Cookie", ownerCookie);
    expect(res.status).toBe(400);
  });

  it("accepts valid type/status query filters", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Idee", type: "IDEA" });
    const res = await request(app).get("/items?type=IDEA&status=INBOX").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
  });
});
