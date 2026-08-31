import { describe, it, expect, vi, afterEach } from "vitest";
import { assertRequiredEnv } from "../src/lib/assertRequiredEnv";

describe("assertRequiredEnv", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.JWT_SECRET = originalSecret;
    vi.restoreAllMocks();
  });

  it("exits the process when JWT_SECRET is missing (outside test mode)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => undefined) as unknown) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertRequiredEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does nothing when NODE_ENV is test, even with vars missing", () => {
    process.env.NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => undefined) as unknown) as () => never);

    assertRequiredEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
