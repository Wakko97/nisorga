import { describe, it, expect } from "vitest";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "./datetime";

describe("datetime-local conversion", () => {
  it("round-trips a local wall-clock value through an ISO string", () => {
    const localValue = "2026-03-15T10:30";
    const iso = fromDatetimeLocalValue(localValue);
    // The ISO string must actually represent the same local wall-clock time
    // when converted back, regardless of the environment's timezone.
    expect(toDatetimeLocalValue(iso)).toBe(localValue);
  });

  it("produces an offset-bearing (UTC) ISO string, not a naive local string", () => {
    const iso = fromDatetimeLocalValue("2026-06-01T12:00");
    expect(iso.endsWith("Z")).toBe(true);
  });
});
