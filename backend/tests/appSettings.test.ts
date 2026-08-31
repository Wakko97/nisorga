import { describe, it, expect, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { decrypt } from "../src/lib/crypto";
import { isGoogleConfigured } from "../src/lib/google";
import { getWaitingReminderDays } from "../src/lib/appConfig";

// /settings/app is Owner-only, but self-registration always creates a
// MEMBER once the setup wizard has run - see the same helper/comment in
// mailSettings.test.ts.
async function createOwnerAndLogin(email: string) {
  const passwordHash = await bcrypt.hash("password123", 10);
  await prisma.user.create({
    data: { email, passwordHash, name: "Owner", role: "OWNER", emailInboundToken: crypto.randomUUID() },
  });
  const login = await request(app).post("/auth/login").send({ email, password: "password123" });
  return login.headers["set-cookie"];
}

async function registerMember(email: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name: "Member" });
  return res.headers["set-cookie"];
}

describe("Settings: /settings/app", () => {
  it("rejects non-owners with 403", async () => {
    const memberCookie = await registerMember("member@test.com");

    const getRes = await request(app).get("/settings/app").set("Cookie", memberCookie);
    expect(getRes.status).toBe(403);

    const putRes = await request(app)
      .put("/settings/app")
      .set("Cookie", memberCookie)
      .send({ waitingReminderDays: 5 });
    expect(putRes.status).toBe(403);
  });

  it("returns unconfigured defaults when nothing is set", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    const res = await request(app).get("/settings/app").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.google.clientId).toBe("");
    expect(res.body.google.secretSet).toBe(false);
    expect(res.body.waitingReminderDays).toBe(3);
  });

  it("saves Google OAuth settings, never echoes the secret back, and encrypts it at rest", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    const putRes = await request(app)
      .put("/settings/app")
      .set("Cookie", ownerCookie)
      .send({
        google: {
          clientId: "client-123.apps.googleusercontent.com",
          clientSecret: "google-secret",
          redirectUri: "https://nisorga.example.com/integrations/google/callback",
        },
      });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/settings/app").set("Cookie", ownerCookie);
    expect(getRes.body.google).toMatchObject({
      clientId: "client-123.apps.googleusercontent.com",
      redirectUri: "https://nisorga.example.com/integrations/google/callback",
      secretSet: true,
    });
    expect(getRes.body.google.clientSecret).toBeUndefined();

    const state = await prisma.appState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.googleClientSecretEnc).not.toBe("google-secret");
    expect(decrypt(state.googleClientSecretEnc!)).toBe("google-secret");

    expect(await isGoogleConfigured()).toBe(true);
  });

  it("keeps the stored secret when a later PUT omits it, and clears it when clientSecret is an empty string", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    await request(app)
      .put("/settings/app")
      .set("Cookie", ownerCookie)
      .send({ google: { clientId: "client-123", clientSecret: "first-secret" } });

    await request(app).put("/settings/app").set("Cookie", ownerCookie).send({ google: { clientId: "client-456" } });

    let state = await prisma.appState.findUniqueOrThrow({ where: { id: 1 } });
    expect(decrypt(state.googleClientSecretEnc!)).toBe("first-secret");
    expect(state.googleClientId).toBe("client-456");

    await request(app).put("/settings/app").set("Cookie", ownerCookie).send({ google: { clientSecret: "" } });

    state = await prisma.appState.findUniqueOrThrow({ where: { id: 1 } });
    expect(state.googleClientSecretEnc).toBeNull();
    expect(await isGoogleConfigured()).toBe(false);
  });

  it("saves waitingReminderDays and applies it via getWaitingReminderDays()", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    await request(app).put("/settings/app").set("Cookie", ownerCookie).send({ waitingReminderDays: 5 });

    expect(await getWaitingReminderDays()).toBe(5);

    const meRes = await request(app).get("/auth/me").set("Cookie", ownerCookie);
    expect(meRes.body.waitingReminderDays).toBe(5);
  });
});

describe("appConfig/google: Settings take priority over env vars", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("getWaitingReminderDays() falls back to the env var when unset in Settings", async () => {
    process.env.WAITING_REMINDER_DAYS = "7";
    expect(await getWaitingReminderDays()).toBe(7);
  });

  it("getWaitingReminderDays() prefers Settings (DB) over the env var once configured", async () => {
    process.env.WAITING_REMINDER_DAYS = "7";

    const ownerCookie = await createOwnerAndLogin("owner@test.com");
    await request(app).put("/settings/app").set("Cookie", ownerCookie).send({ waitingReminderDays: 2 });

    expect(await getWaitingReminderDays()).toBe(2);
  });

  it("isGoogleConfigured() falls back to env vars when unset in Settings", async () => {
    process.env.GOOGLE_CLIENT_ID = "env-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "env-secret";
    expect(await isGoogleConfigured()).toBe(true);
  });
});
