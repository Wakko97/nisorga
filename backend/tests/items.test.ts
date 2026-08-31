import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import * as webhooksLib from "../src/lib/webhooks";

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

describe("bulk item operations", () => {
  let ownerCookie: string[];
  let memberCookie: string[];

  beforeEach(async () => {
    ownerCookie = await registerAndLogin("owner@test.com", "Owner");
    memberCookie = await registerAndLogin("member@test.com", "Member");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates multiple own items correctly with PATCH /items/bulk", async () => {
    const a = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "A" });
    const b = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "B" });

    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids: [a.body.id, b.body.id], patch: { important: true } });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(2);
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.updated.every((i: any) => i.important === true)).toBe(true);
  });

  it("skips items the requesting user has no access to, without modifying them", async () => {
    const ownerItem = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Owner-only" });

    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", memberCookie)
      .send({ ids: [ownerItem.body.id], patch: { important: true } });

    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(0);
    expect(res.body.skipped).toEqual([{ id: ownerItem.body.id, reason: "forbidden" }]);

    const stillUnchanged = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(stillUnchanged.body[0].important).toBe(false);
  });

  it("reports not_found for ids that do not exist", async () => {
    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids: ["00000000-0000-0000-0000-000000000000"], patch: { important: true } });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual([{ id: "00000000-0000-0000-0000-000000000000", reason: "not_found" }]);
  });

  it("sets waitingSince correctly when status: WAITING is applied via bulk patch", async () => {
    const item = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Delegiert" });

    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids: [item.body.id], patch: { status: "WAITING" } });

    expect(res.status).toBe(200);
    expect(res.body.updated[0].status).toBe("WAITING");
    expect(res.body.updated[0].waitingSince).not.toBeNull();
  });

  it("deletes authorized items and leaves items belonging to other users untouched via DELETE /items/bulk", async () => {
    const ownItem = await request(app).post("/items").set("Cookie", memberCookie).send({ title: "Mein Item" });
    const ownerItem = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Owner-only" });

    const res = await request(app)
      .delete("/items/bulk")
      .set("Cookie", memberCookie)
      .send({ ids: [ownItem.body.id, ownerItem.body.id] });

    expect(res.status).toBe(200);
    expect(res.body.deletedIds).toEqual([ownItem.body.id]);
    expect(res.body.skipped).toEqual([{ id: ownerItem.body.id, reason: "forbidden" }]);

    const ownerItems = await request(app).get("/items").set("Cookie", ownerCookie);
    expect(ownerItems.body.map((i: any) => i.id)).toContain(ownerItem.body.id);
  });

  it("rejects an empty ids array with 400", async () => {
    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids: [], patch: { important: true } });
    expect(res.status).toBe(400);
  });

  it("rejects more than the maximum allowed ids with 400", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids, patch: { important: true } });
    expect(res.status).toBe(400);
  });

  it("rejects an empty ids array with 400 for DELETE /items/bulk", async () => {
    const res = await request(app).delete("/items/bulk").set("Cookie", ownerCookie).send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("fires item.updated webhooks for each item actually updated in bulk", async () => {
    const fireWebhooksSpy = vi.spyOn(webhooksLib, "fireWebhooks").mockResolvedValue(undefined);

    const a = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "A" });
    const b = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "B" });
    fireWebhooksSpy.mockClear();

    const res = await request(app)
      .patch("/items/bulk")
      .set("Cookie", ownerCookie)
      .send({ ids: [a.body.id, b.body.id], patch: { important: true } });

    expect(res.status).toBe(200);
    expect(fireWebhooksSpy).toHaveBeenCalledTimes(2);
    expect(fireWebhooksSpy).toHaveBeenCalledWith(
      expect.any(String),
      "item.updated",
      expect.objectContaining({ id: a.body.id })
    );
    expect(fireWebhooksSpy).toHaveBeenCalledWith(
      expect.any(String),
      "item.updated",
      expect.objectContaining({ id: b.body.id })
    );
  });
});

describe("search (GET /items?q=...)", () => {
  let ownerCookie: string[];

  beforeEach(async () => {
    ownerCookie = await registerAndLogin("owner@test.com", "Owner");
    await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Steuererklärung einreichen", description: "Fristende 31.07." });
    await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Milch kaufen", description: "für den Steuerberater-Termin vorbereiten" });
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Team-Meeting vorbereiten" });
  });

  it("matches items by title, case-insensitively", async () => {
    const res = await request(app).get("/items?q=steuer").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.map((i: { title: string }) => i.title).sort()).toEqual([
      "Milch kaufen",
      "Steuererklärung einreichen",
    ]);
  });

  it("also matches items by description", async () => {
    const res = await request(app).get("/items?q=Fristende").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Steuererklärung einreichen");
  });

  it("returns everything visible when q is empty or omitted", async () => {
    const res = await request(app).get("/items?q=").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });

  it("returns an empty list for a query matching nothing", async () => {
    const res = await request(app).get("/items?q=xyz-does-not-exist").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("combines with the type/status filters", async () => {
    await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Steuerbescheid prüfen", type: "TASK", status: "TODO" });

    const res = await request(app).get("/items?q=steuer&type=TASK").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Steuerbescheid prüfen");
  });
});

describe("export (GET /items/export)", () => {
  let ownerCookie: string[];
  let memberCookie: string[];

  beforeEach(async () => {
    ownerCookie = await registerAndLogin("owner@test.com", "Owner");
    memberCookie = await registerAndLogin("member@test.com", "Member");
    await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Mit \"Anführungszeichen\", Komma", description: "Zeile eins\nZeile zwei" });
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Zweites Item" });
  });

  it("defaults to CSV with the right headers and a matching row count", async () => {
    const res = await request(app).get("/items/export").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="nisorga-items-\d{4}-\d{2}-\d{2}\.csv"$/);

    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toBe(
      "id,type,title,description,status,important,urgent,dueDate,waitingSince,source,createdBy,assignedTo,createdAt,updatedAt"
    );
    // header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it("quotes and escapes CSV fields containing commas/quotes/newlines", async () => {
    const res = await request(app).get("/items/export?format=csv").set("Cookie", ownerCookie);
    expect(res.text).toContain('"Mit ""Anführungszeichen"", Komma"');
    expect(res.text).toContain('"Zeile eins\nZeile zwei"');
  });

  it("supports format=json with a Content-Disposition attachment header", async () => {
    const res = await request(app).get("/items/export?format=json").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="nisorga-items-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((i: { title: string }) => i.title)).toContain("Zweites Item");
  });

  it("rejects an unknown format", async () => {
    const res = await request(app).get("/items/export?format=xml").set("Cookie", ownerCookie);
    expect(res.status).toBe(400);
  });

  it("respects visibility rules like GET /items", async () => {
    const res = await request(app).get("/items/export?format=json").set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("combines with type/status/q filters like GET /items", async () => {
    const res = await request(app).get("/items/export?format=json&q=zweites").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Zweites Item");
  });
});
