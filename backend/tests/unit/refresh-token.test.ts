import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from "../../src/modules/auth/refresh-token.js";

describe("generateRefreshToken", () => {
  it("returns a URL-safe token carrying 256 bits (43 base64url characters)", () => {
    const { token } = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns a 64-character hex hash, the format the database requires", () => {
    const { hash } = generateRefreshToken();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a hash that matches its token and is not the token itself", () => {
    const { token, hash } = generateRefreshToken();

    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toBe(token);
  });

  it("never repeats (1000 tokens, all different)", () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => generateRefreshToken().token),
    );

    expect(tokens.size).toBe(1000);
  });
});

describe("hashRefreshToken", () => {
  it("is deterministic, so a presented token can be looked up", () => {
    expect(hashRefreshToken("abc")).toBe(hashRefreshToken("abc"));
  });

  it("gives different hashes for different tokens", () => {
    expect(hashRefreshToken("abc")).not.toBe(hashRefreshToken("abd"));
  });
});

describe("refreshTokenExpiry", () => {
  it("is exactly 7 days after the given time", () => {
    const now = new Date("2026-10-10T12:00:00Z");

    expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(refreshTokenExpiry(now).toISOString()).toBe("2026-10-17T12:00:00.000Z");
  });
});
