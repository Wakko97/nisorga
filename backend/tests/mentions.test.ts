import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import * as sendgridLib from "../src/lib/sendgrid";

// Registration fires the verification email fire-and-forget (unawaited), so
// spy from the start and clear it once that settles rather than racing to
// attach the spy after the register request already resolved.
async function registerAndLogin(email: string, name: string, sendEmailSpy: ReturnType<typeof vi.spyOn>) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  await new Promise((r) => setTimeout(r, 50));
  sendEmailSpy.mockClear();
  return res.headers["set-cookie"];
}

describe("@-mentions in comments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emails a mentioned user (matched by name, spaces stripped) but not the comment author", async () => {
    const sendEmailSpy = vi.spyOn(sendgridLib, "sendEmail").mockResolvedValue(undefined);
    const ownerCookie = await registerAndLogin("owner@test.com", "Lisa Müller", sendEmailSpy);
    await registerAndLogin("bob@test.com", "Bob", sendEmailSpy);

    const item = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Q3-Planung" });

    const res = await request(app)
      .post(`/items/${item.body.id}/comments`)
      .set("Cookie", ownerCookie)
      .send({ body: "@Bob kannst du das übernehmen? @LisaMüller schon erledigt." });
    expect(res.status).toBe(201);

    await new Promise((r) => setTimeout(r, 50));

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      "bob@test.com",
      expect.stringContaining("erwähnt"),
      expect.any(String)
    );
  });

  it("does not send an email when nobody is mentioned", async () => {
    const sendEmailSpy = vi.spyOn(sendgridLib, "sendEmail").mockResolvedValue(undefined);
    const ownerCookie = await registerAndLogin("owner2@test.com", "Owner", sendEmailSpy);

    const item = await request(app).post("/items").set("Cookie", ownerCookie).send({ title: "Ohne Erwähnung" });
    await request(app).post(`/items/${item.body.id}/comments`).set("Cookie", ownerCookie).send({ body: "Alles klar." });
    await new Promise((r) => setTimeout(r, 50));

    expect(sendEmailSpy).not.toHaveBeenCalled();
  });
});
