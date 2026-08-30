import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { runReminderCheck } from "../src/jobs/reminders";
import { runWeeklyDigest } from "../src/jobs/weeklyDigest";

describe("scheduled jobs", () => {
  let ownerCookie: string[];

  beforeEach(async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "owner@test.com", password: "password123", name: "Owner" });
    ownerCookie = res.headers["set-cookie"];
  });

  it("only reminds about items that have been WAITING longer than the threshold", async () => {
    const item = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Delegiert" });
    await request(app).patch(`/items/${item.body.id}`).set("Cookie", ownerCookie).send({ status: "WAITING" });

    const tooSoon = await runReminderCheck();
    expect(tooSoon.checked).toBe(0);

    await prisma.item.update({
      where: { id: item.body.id },
      data: { waitingSince: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });

    const overdue = await runReminderCheck();
    expect(overdue.checked).toBe(1);
  });

  it("runs the weekly digest for every user without throwing", async () => {
    await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Idee" });
    const result = await runWeeklyDigest();
    expect(result.users).toBeGreaterThanOrEqual(1);
  });
});
