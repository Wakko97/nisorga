import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLock = { release: vi.fn() };
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
  getMailboxLock: vi.fn().mockResolvedValue(mockLock),
  search: vi.fn(),
  fetchOne: vi.fn(),
  messageFlagsAdd: vi.fn().mockResolvedValue(true),
};

vi.mock("imapflow", () => ({
  // Regular function, not an arrow function: vitest invokes this via `new`
  // (imapPoll.ts does `new ImapFlow(...)`), and arrow functions can't be
  // used as constructors.
  ImapFlow: vi.fn(function ImapFlow() {
    return mockClient;
  }),
}));

vi.mock("mailparser", () => ({
  simpleParser: vi.fn(),
}));

vi.mock("../src/lib/inboundEmail", () => ({
  createItemFromInboundEmail: vi.fn(),
}));

import { runImapPoll } from "../src/jobs/imapPoll";
import { createItemFromInboundEmail } from "../src/lib/inboundEmail";
import { simpleParser } from "mailparser";

describe("runImapPoll", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.getMailboxLock.mockResolvedValue(mockLock);
    mockClient.messageFlagsAdd.mockResolvedValue(true);
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user@example.com";
    process.env.IMAP_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("no-ops when IMAP is not configured", async () => {
    delete process.env.IMAP_HOST;

    const result = await runImapPoll();

    expect(result).toEqual({ processed: 0 });
    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it("processes unseen messages and marks each as read", async () => {
    mockClient.search.mockResolvedValue([1, 2]);
    mockClient.fetchOne
      .mockResolvedValueOnce({ source: Buffer.from("raw1") })
      .mockResolvedValueOnce({ source: Buffer.from("raw2") });
    vi.mocked(simpleParser)
      .mockResolvedValueOnce({ to: { text: "inbox+tok1@x" }, subject: "S1", text: "T1" } as any)
      .mockResolvedValueOnce({ to: { text: "inbox+tok2@x" }, subject: "S2", text: "T2" } as any);

    const result = await runImapPoll();

    expect(result).toEqual({ processed: 2 });
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.getMailboxLock).toHaveBeenCalledWith("INBOX");
    expect(createItemFromInboundEmail).toHaveBeenCalledWith({ to: "inbox+tok1@x", subject: "S1", text: "T1" });
    expect(createItemFromInboundEmail).toHaveBeenCalledWith({ to: "inbox+tok2@x", subject: "S2", text: "T2" });
    expect(mockClient.messageFlagsAdd).toHaveBeenCalledTimes(2);
    expect(mockLock.release).toHaveBeenCalled();
    expect(mockClient.logout).toHaveBeenCalled();
  });

  it("still marks a message as read even if processing it throws", async () => {
    mockClient.search.mockResolvedValue([1]);
    mockClient.fetchOne.mockResolvedValue({ source: Buffer.from("raw") });
    vi.mocked(simpleParser).mockRejectedValue(new Error("boom"));

    const result = await runImapPoll();

    expect(result).toEqual({ processed: 0 });
    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(1, ["\\Seen"], { uid: true });
    expect(mockLock.release).toHaveBeenCalled();
  });
});
