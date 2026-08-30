import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("api/v1 rate limiting", () => {
  it("sets standard rate-limit headers on responses", async () => {
    const res = await request(app).get("/api/v1/items").set("Authorization", "Bearer invalid-key");
    // Rate-limit middleware runs before API-key auth, so headers are present
    // even on an otherwise-unauthorized request.
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("still enforces API-key auth behind the rate limiter", async () => {
    const res = await request(app).get("/api/v1/items").set("Authorization", "Bearer invalid-key");
    expect(res.status).toBe(401);
  });
});
