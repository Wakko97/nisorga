import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl } from "../src/lib/ssrfGuard";

describe("assertPublicHttpUrl", () => {
  it("rejects loopback addresses", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/x")).rejects.toThrow();
  });

  it("rejects the cloud metadata address", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/")).rejects.toThrow();
  });

  it("rejects localhost", async () => {
    await expect(assertPublicHttpUrl("http://localhost/")).rejects.toThrow();
  });

  it("rejects private RFC1918 ranges", async () => {
    await expect(assertPublicHttpUrl("http://10.0.0.5/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://172.16.0.5/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://192.168.1.5/")).rejects.toThrow();
  });

  it("rejects IPv6 loopback and link-local", async () => {
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[fe80::1]/")).rejects.toThrow();
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("accepts a public https URL", async () => {
    await expect(assertPublicHttpUrl("https://example.com")).resolves.toBeUndefined();
  });
});
