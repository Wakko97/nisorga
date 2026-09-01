import { describe, it, expect, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import request from "supertest";
import { app } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { getSmtpConfig, getImapConfig } from "../src/lib/mailConfig";

// /settings/mail is Owner-only, but self-registration (POST /auth/register)
// always creates a MEMBER once the setup wizard has run (see
// routes/auth.ts) - so, unlike most other tests, we need a genuine OWNER
// here. Created directly via Prisma (bypassing POST /setup/init, which can
// only ever create one) and then logged in normally so the session cookie
// reflects the real role from the DB.
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

describe("Settings: /settings/mail", () => {
  it("rejects non-owners with 403", async () => {
    const memberCookie = await registerMember("member@test.com");

    const getRes = await request(app).get("/settings/mail").set("Cookie", memberCookie);
    expect(getRes.status).toBe(403);

    const putRes = await request(app)
      .put("/settings/mail")
      .set("Cookie", memberCookie)
      .send({ smtp: { host: "smtp.example.com" } });
    expect(putRes.status).toBe(403);
  });

  it("returns unconfigured defaults when nothing is set", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    const res = await request(app).get("/settings/mail").set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.smtp.host).toBe("");
    expect(res.body.smtp.passwordSet).toBe(false);
    expect(res.body.imap.host).toBe("");
    expect(res.body.imap.passwordSet).toBe(false);
  });

  it("saves SMTP settings, never echoes the password back, and applies them via getSmtpConfig()", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    const putRes = await request(app)
      .put("/settings/mail")
      .set("Cookie", ownerCookie)
      .send({
        smtp: {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "smtp-user",
          password: "smtp-secret",
          fromEmail: "noreply@example.com",
        },
      });
    expect(putRes.status).toBe(200);

    const getRes = await request(app).get("/settings/mail").set("Cookie", ownerCookie);
    expect(getRes.body.smtp).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "smtp-user",
      fromEmail: "noreply@example.com",
      passwordSet: true,
    });
    expect(getRes.body.smtp.password).toBeUndefined();

    const resolved = await getSmtpConfig();
    expect(resolved).toMatchObject({ host: "smtp.example.com", port: 465, password: "smtp-secret" });
  });

  it("keeps the stored password when a later PUT omits it, and clears it when password is an empty string", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    await request(app)
      .put("/settings/mail")
      .set("Cookie", ownerCookie)
      .send({ smtp: { host: "smtp.example.com", password: "first-secret" } });

    // Update only the port - password field omitted entirely.
    await request(app).put("/settings/mail").set("Cookie", ownerCookie).send({ smtp: { port: 2525 } });

    let resolved = await getSmtpConfig();
    expect(resolved?.password).toBe("first-secret");
    expect(resolved?.port).toBe(2525);

    // Explicitly clear it.
    await request(app).put("/settings/mail").set("Cookie", ownerCookie).send({ smtp: { password: "" } });

    resolved = await getSmtpConfig();
    expect(resolved?.password).toBeUndefined();
  });

  it("saves IMAP settings and applies them via getImapConfig()", async () => {
    const ownerCookie = await createOwnerAndLogin("owner@test.com");

    await request(app)
      .put("/settings/mail")
      .set("Cookie", ownerCookie)
      .send({
        imap: {
          host: "imap.example.com",
          port: 993,
          secure: true,
          user: "imap-user",
          password: "imap-secret",
          mailbox: "INBOX",
          inboundDomain: "inbound.example.com",
        },
      });

    const resolved = await getImapConfig();
    expect(resolved).toMatchObject({
      host: "imap.example.com",
      user: "imap-user",
      password: "imap-secret",
      mailbox: "INBOX",
    });

    const emailSettings = await request(app).get("/settings/email").set("Cookie", ownerCookie);
    expect(emailSettings.body.address).toMatch(/@inbound\.example\.com$/);
  });
});

describe("mailConfig: Settings take priority over env vars", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("getSmtpConfig() falls back to env vars when nothing is configured in Settings", async () => {
    process.env.SMTP_HOST = "env-smtp.example.com";
    process.env.SMTP_PASSWORD = "env-secret";

    const resolved = await getSmtpConfig();
    expect(resolved).toMatchObject({ host: "env-smtp.example.com", password: "env-secret" });
  });

  it("getSmtpConfig() prefers Settings (DB) over env vars once configured", async () => {
    process.env.SMTP_HOST = "env-smtp.example.com";

    const ownerCookie = await createOwnerAndLogin("owner@test.com");
    await request(app)
      .put("/settings/mail")
      .set("Cookie", ownerCookie)
      .send({ smtp: { host: "settings-smtp.example.com" } });

    const resolved = await getSmtpConfig();
    expect(resolved?.host).toBe("settings-smtp.example.com");
  });
});
