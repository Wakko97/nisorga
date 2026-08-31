import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signOAuthState, verifyOAuthState } from "../src/lib/google";

describe("google OAuth state token", () => {
  it("accepts a validly signed state token and returns the correct user id", () => {
    const state = signOAuthState("user-123");
    const payload = verifyOAuthState(state);
    expect(payload.uid).toBe("user-123");
  });

  it("rejects an expired state token", () => {
    const expired = jwt.sign({ uid: "user-123", nonce: "n" }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect(() => verifyOAuthState(expired)).toThrow();
  });

  it("rejects a tampered/forged state token", () => {
    const forged = jwt.sign({ uid: "someone-else" }, "wrong-secret", { expiresIn: "10m" });
    expect(() => verifyOAuthState(forged)).toThrow();
  });

  it("rejects a raw user id passed as state (not a signed token)", () => {
    expect(() => verifyOAuthState("just-a-raw-user-id")).toThrow();
  });
});
