import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";

describe("weekly review", () => {
  let ownerCookie: string[];
  let ownerId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    ownerCookie = res.headers["set-cookie"];
    ownerId = res.body.id;
  });

  it("buckets items into openInboxItems, overdueTasks and staleIdeas", async () => {
    // Fresh inbox idea — should show up in openInboxItems, not staleIdeas (too new).
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Frische Idee" });

    // Overdue task.
    const task = await request(app)
      .post("/items")
      .set("Cookie", ownerCookie)
      .send({ title: "Überfällige Aufgabe", type: "TASK", status: "TODO", dueDate: "2020-01-01" });
    expect(task.status).toBe(201);

    // Stale idea: backdate createdAt directly via Prisma (API doesn't expose it).
    const staleIdea = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Alte Idee" });
    await prisma.item.update({
      where: { id: staleIdea.body.id },
      data: { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(app).get("/review/weekly").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.openInboxItems.map((i: any) => i.title)).toContain("Frische Idee");
    expect(res.body.overdueTasks.map((i: any) => i.title)).toContain("Überfällige Aufgabe");
    expect(res.body.staleIdeas.map((i: any) => i.title)).toContain("Alte Idee");
    expect(res.body.staleIdeas.map((i: any) => i.title)).not.toContain("Frische Idee");
  });

  it("never leaks passwordHash through the review endpoint", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Idee" });
    const res = await request(app).get("/review/weekly").set("Cookie", ownerCookie);
    const item = res.body.openInboxItems[0];
    expect(item.createdBy.passwordHash).toBeUndefined();
  });

  it("exports the weekly review as a downloadable CSV", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "CSV-Idee" });

    const res = await request(app).get("/review/weekly/export.csv").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="wochenrueckblick-/);
    expect(res.text).toContain('"Kategorie","Titel","Status","Zugewiesen","Fällig","Erstellt"');
    expect(res.text).toContain("CSV-Idee");
  });
});
