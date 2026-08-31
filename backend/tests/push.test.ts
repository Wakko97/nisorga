import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  },
}));

import { prisma } from "../src/lib/prisma";
import { sendPushToUser, isPushConfigured, getVapidPublicKey } from "../src/lib/push";

async function createUser(email: string) {
  const bcrypt = await import("bcryptjs");
  const crypto = await import("crypto");
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("password123", 10),
      name: "Test",
      role: "MEMBER",
      emailInboundToken: crypto.randomUUID(),
    },
  });
}

describe("push.ts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("isPushConfigured()/getVapidPublicKey() reflect whether VAPID keys are set", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    // Re-import to pick up the env change (module reads env at import time).
    vi.resetModules();
    const unconfigured = await import("../src/lib/push");
    expect(unconfigured.isPushConfigured()).toBe(false);
    expect(unconfigured.getVapidPublicKey()).toBeNull();

    process.env.VAPID_PUBLIC_KEY = "pub-key";
    process.env.VAPID_PRIVATE_KEY = "priv-key";
    vi.resetModules();
    const configured = await import("../src/lib/push");
    expect(configured.isPushConfigured()).toBe(true);
    expect(configured.getVapidPublicKey()).toBe("pub-key");
  });

  it("no-ops without sending when VAPID keys are not configured", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    vi.resetModules();
    const { sendPushToUser: send } = await import("../src/lib/push");

    const user = await createUser("push1@test.com");
    await send(user.id, { title: "T", body: "B" });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends to every subscription for the user", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    process.env.VAPID_PRIVATE_KEY = "priv-key";
    vi.resetModules();
    const { sendPushToUser: send } = await import("../src/lib/push");

    const user = await createUser("push2@test.com");
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example.com/a", p256dh: "p1", auth: "a1" },
    });
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example.com/b", p256dh: "p2", auth: "a2" },
    });
    mockSendNotification.mockResolvedValue(undefined);

    await send(user.id, { title: "Reminder", body: "Body text", url: "https://app.example.com/items/1" });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example.com/a", keys: { p256dh: "p1", auth: "a1" } },
      JSON.stringify({ title: "Reminder", body: "Body text", url: "https://app.example.com/items/1" })
    );
  });

  it("deletes a subscription that the push service reports as gone (410)", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    process.env.VAPID_PRIVATE_KEY = "priv-key";
    vi.resetModules();
    const { sendPushToUser: send } = await import("../src/lib/push");

    const user = await createUser("push3@test.com");
    const sub = await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example.com/gone", p256dh: "p", auth: "a" },
    });
    mockSendNotification.mockRejectedValue({ statusCode: 410 });

    await send(user.id, { title: "T", body: "B" });

    const remaining = await prisma.pushSubscription.findUnique({ where: { id: sub.id } });
    expect(remaining).toBeNull();
  });

  it("keeps a subscription on a non-410/404 error", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    process.env.VAPID_PRIVATE_KEY = "priv-key";
    vi.resetModules();
    const { sendPushToUser: send } = await import("../src/lib/push");

    const user = await createUser("push4@test.com");
    const sub = await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example.com/flaky", p256dh: "p", auth: "a" },
    });
    mockSendNotification.mockRejectedValue({ statusCode: 500 });

    await send(user.id, { title: "T", body: "B" });

    const remaining = await prisma.pushSubscription.findUnique({ where: { id: sub.id } });
    expect(remaining).not.toBeNull();
  });
});
