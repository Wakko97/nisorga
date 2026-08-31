import { describe, it, expect } from "vitest";
import { daysSince, isWaitingOverdue, WAITING_OVERDUE_DAYS } from "./waiting";

describe("daysSince", () => {
  it("returns 0 for a timestamp from just now", () => {
    expect(daysSince(new Date().toISOString())).toBe(0);
  });

  it("returns the number of full days elapsed", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(fiveDaysAgo)).toBe(5);
  });
});

describe("isWaitingOverdue", () => {
  it("is false when status is not WAITING", () => {
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isWaitingOverdue("TODO", longAgo)).toBe(false);
  });

  it("is false when waitingSince is null", () => {
    expect(isWaitingOverdue("WAITING", null)).toBe(false);
  });

  it("is false just under the overdue threshold", () => {
    const almost = new Date(Date.now() - (WAITING_OVERDUE_DAYS * 24 * 60 * 60 * 1000 - 1000)).toISOString();
    expect(isWaitingOverdue("WAITING", almost)).toBe(false);
  });

  it("is true once the overdue threshold is reached", () => {
    const overdue = new Date(Date.now() - WAITING_OVERDUE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(isWaitingOverdue("WAITING", overdue)).toBe(true);
  });
});
