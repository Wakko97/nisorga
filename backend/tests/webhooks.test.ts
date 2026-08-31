import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app";

async function registerAndLogin(email: string, name: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  return res.headers["set-cookie"];
}

describe("webhooks", () => {
  let cookie: string[];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cookie = await registerAndLogin(`webhook-${Date.now()}@test.com`, "Owner");
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("posts a Slack-compatible {text} payload for SLACK-format webhooks", async () => {
    await request(app)
      .post("/settings/webhooks")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/services/x", events: ["item.created"], format: "SLACK" });

    await request(app).post("/items").set("Cookie", cookie).send({ title: "Rechnung prüfen" });

    // Webhook dispatch is fire-and-forget; give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/services/x",
      expect.objectContaining({
        body: JSON.stringify({ text: "*item.created*: Rechnung prüfen" }),
      })
    );
  });

  it("posts the generic {event, item} payload by default", async () => {
    await request(app)
      .post("/settings/webhooks")
      .set("Cookie", cookie)
      .send({ url: "https://example.com/hook", events: ["item.created"] });

    const created = await request(app).post("/items").set("Cookie", cookie).send({ title: "Idee" });

    await new Promise((r) => setTimeout(r, 50));

    const call = fetchSpy.mock.calls.find((c) => c[0] === "https://example.com/hook");
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.event).toBe("item.created");
    expect(body.item.id).toBe(created.body.id);
  });
});
