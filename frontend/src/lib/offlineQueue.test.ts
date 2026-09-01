import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./api";
import { enqueueItem, flushQueue, getQueue } from "./offlineQueue";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

describe("offlineQueue", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.post).mockReset();
  });

  it("stops the flush at the first network error, keeping unsynced items queued", async () => {
    enqueueItem("A");
    enqueueItem("B");
    vi.mocked(api.post).mockRejectedValue(new TypeError("Failed to fetch"));

    const synced = await flushQueue();

    expect(synced).toBe(0);
    expect(getQueue().map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("skips an item that fails with a non-network error instead of wedging the rest of the queue", async () => {
    enqueueItem("Stale auth");
    enqueueItem("Should still sync");
    vi.mocked(api.post)
      .mockRejectedValueOnce(new ApiError(401, "Unauthorized"))
      .mockResolvedValueOnce({});

    const synced = await flushQueue();

    expect(synced).toBe(1);
    // The failed item stays queued (not lost); the one behind it got through.
    expect(getQueue().map((i) => i.title)).toEqual(["Stale auth"]);
  });

  it("de-duplicates overlapping flush calls instead of double-posting", async () => {
    enqueueItem("Only once");
    let resolvePost: () => void;
    vi.mocked(api.post).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = () => resolve({});
      })
    );

    const first = flushQueue();
    const second = flushQueue(); // fires while the first is still in flight
    resolvePost!();
    await Promise.all([first, second]);

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("does not report an item as queued when the write actually fails", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const ok = enqueueItem("Won't fit");

    expect(ok).toBe(false);
    expect(getQueue()).toEqual([]);
    setItemSpy.mockRestore();
  });
});
