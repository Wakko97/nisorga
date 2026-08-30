import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../src/lib/crypto";

describe("token encryption", () => {
  it("round-trips a plaintext string", () => {
    const plaintext = "ya29.some-google-access-token";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encrypt("same-token");
    const b = encrypt("same-token");
    expect(a).not.toBe(b);
  });

  it("throws when the auth tag has been tampered with", () => {
    const encrypted = encrypt("secret-value");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const flippedFirstChar = authTag[0] === "0" ? "1" : "0";
    const tamperedAuthTag = flippedFirstChar + authTag.slice(1);
    expect(() => decrypt(`${iv}:${tamperedAuthTag}:${ciphertext}`)).toThrow();
  });
});
