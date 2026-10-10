import { describe, expect, it } from "vitest";
import {
  BCRYPT_COST,
  hashPassword,
  isPasswordAcceptable,
  verifyPassword,
} from "../../src/modules/auth/password.js";

// Cost 4 is the bcrypt minimum: fast enough for tests. One test checks the real default.
const TEST_COST = 4;

describe("isPasswordAcceptable (length counted in UTF-8 bytes)", () => {
  it("rejects 7 bytes and accepts 8", () => {
    expect(isPasswordAcceptable("a".repeat(7))).toBe(false);
    expect(isPasswordAcceptable("a".repeat(8))).toBe(true);
  });

  it("accepts 72 bytes and rejects 73", () => {
    expect(isPasswordAcceptable("a".repeat(72))).toBe(true);
    expect(isPasswordAcceptable("a".repeat(73))).toBe(false);
  });

  it("counts bytes, not characters: 25 emoji are 100 bytes", () => {
    expect(isPasswordAcceptable("😀".repeat(25))).toBe(false);
    expect(isPasswordAcceptable("😀".repeat(18))).toBe(true); // 72 bytes
  });

  it("rejects the empty string", () => {
    expect(isPasswordAcceptable("")).toBe(false);
  });
});

describe("hashPassword", () => {
  it("uses bcrypt with cost 12 by default", async () => {
    const hash = await hashPassword("correct horse");

    expect(BCRYPT_COST).toBe(12);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("never returns the plain password", async () => {
    const hash = await hashPassword("correct horse", TEST_COST);

    expect(hash).not.toContain("correct horse");
  });

  it("salts: the same password hashes differently each time", async () => {
    const first = await hashPassword("correct horse", TEST_COST);
    const second = await hashPassword("correct horse", TEST_COST);

    expect(first).not.toBe(second);
  });

  it("refuses a password that breaks the length rule", async () => {
    await expect(hashPassword("short", TEST_COST)).rejects.toThrow();
    await expect(hashPassword("a".repeat(73), TEST_COST)).rejects.toThrow();
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const hash = await hashPassword("correct horse", TEST_COST);

    await expect(verifyPassword("correct horse", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse", TEST_COST);

    await expect(verifyPassword("wrong horse!", hash)).resolves.toBe(false);
  });

  it("is case sensitive", async () => {
    const hash = await hashPassword("Correct Horse", TEST_COST);

    await expect(verifyPassword("correct horse", hash)).resolves.toBe(false);
  });

  it("returns false (not an error) when there is no stored hash", async () => {
    await expect(verifyPassword("anything at all", null)).resolves.toBe(false);
  });

  it("does not accept a password that only matches in its first 72 bytes", async () => {
    const seventyTwo = "a".repeat(72);
    const hash = await hashPassword(seventyTwo, TEST_COST);

    // bcrypt alone would say true here (it ignores byte 73 onwards).
    await expect(verifyPassword(seventyTwo + "EXTRA", hash)).resolves.toBe(false);
  });

  it("rejects an empty password", async () => {
    const hash = await hashPassword("correct horse", TEST_COST);

    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });
});
