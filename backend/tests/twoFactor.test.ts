import { describe, it, expect } from "vitest";
import { generate } from "otplib";
import request from "supertest";
import { app } from "../src/app";

async function registerAndLogin(email: string, name: string) {
  const res = await request(app).post("/auth/register").send({ email, password: "password123", name });
  return { cookie: res.headers["set-cookie"] as unknown as string[], id: res.body.id };
}

/** Runs through setup+enable, returning the cookie, the confirmed secret, and the backup codes. */
async function enableTwoFactor(cookie: string[]) {
  const setupRes = await request(app).post("/auth/2fa/setup").set("Cookie", cookie);
  expect(setupRes.status).toBe(200);
  const { secret, qrCodeDataUrl } = setupRes.body;
  expect(typeof secret).toBe("string");
  expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

  const token = await generate({ secret });
  const enableRes = await request(app).post("/auth/2fa/enable").set("Cookie", cookie).send({ token });
  expect(enableRes.status).toBe(200);
  expect(enableRes.body.backupCodes).toHaveLength(10);

  return { secret, backupCodes: enableRes.body.backupCodes as string[] };
}

describe("2FA setup/enable/disable", () => {
  it("setup returns a pending secret without enabling 2FA yet", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");

    await request(app).post("/auth/2fa/setup").set("Cookie", cookie);

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.body.twoFactorEnabled).toBe(false);
  });

  it("enable rejects an incorrect TOTP code", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await request(app).post("/auth/2fa/setup").set("Cookie", cookie);

    const res = await request(app).post("/auth/2fa/enable").set("Cookie", cookie).send({ token: "000000" });
    expect(res.status).toBe(401);

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.body.twoFactorEnabled).toBe(false);
  });

  it("enable with a correct TOTP code turns 2FA on and returns backup codes", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await enableTwoFactor(cookie);

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.body.twoFactorEnabled).toBe(true);
  });

  it("disable requires the correct password", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await enableTwoFactor(cookie);

    const wrong = await request(app).post("/auth/2fa/disable").set("Cookie", cookie).send({ password: "nope" });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .post("/auth/2fa/disable")
      .set("Cookie", cookie)
      .send({ password: "password123" });
    expect(right.status).toBe(200);

    const me = await request(app).get("/auth/me").set("Cookie", cookie);
    expect(me.body.twoFactorEnabled).toBe(false);
  });
});

describe("2FA login flow", () => {
  it("login returns twoFactorRequired + tempToken instead of a session when 2FA is enabled", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await enableTwoFactor(cookie);

    const res = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.twoFactorRequired).toBe(true);
    expect(typeof res.body.tempToken).toBe("string");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("verify-login with a valid TOTP code completes login and sets session cookies", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    const { secret } = await enableTwoFactor(cookie);

    const login = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    const tempToken = login.body.tempToken;

    const token = await generate({ secret });
    const verify = await request(app).post("/auth/2fa/verify-login").send({ tempToken, token });

    expect(verify.status).toBe(200);
    expect(verify.body.email).toBe("owner@test.com");
    expect(verify.headers["set-cookie"]).toBeDefined();
  });

  it("verify-login rejects an invalid TOTP code", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    await enableTwoFactor(cookie);

    const login = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    const verify = await request(app)
      .post("/auth/2fa/verify-login")
      .send({ tempToken: login.body.tempToken, token: "000000" });

    expect(verify.status).toBe(401);
  });

  it("verify-login rejects a malformed/expired tempToken", async () => {
    const res = await request(app)
      .post("/auth/2fa/verify-login")
      .send({ tempToken: "not-a-real-token", token: "123456" });
    expect(res.status).toBe(401);
  });

  it("verify-login accepts a backup code exactly once", async () => {
    const { cookie } = await registerAndLogin("owner@test.com", "Owner");
    const { backupCodes } = await enableTwoFactor(cookie);
    const backupCode = backupCodes[0];

    const login1 = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    const first = await request(app)
      .post("/auth/2fa/verify-login")
      .send({ tempToken: login1.body.tempToken, backupCode });
    expect(first.status).toBe(200);

    const login2 = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    const second = await request(app)
      .post("/auth/2fa/verify-login")
      .send({ tempToken: login2.body.tempToken, backupCode });
    expect(second.status).toBe(401);
  });

  it("login without 2FA enabled is unaffected (no tempToken, session issued directly)", async () => {
    await registerAndLogin("owner@test.com", "Owner");
    const res = await request(app).post("/auth/login").send({ email: "owner@test.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.twoFactorRequired).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });
});
