import { describe, expect, it } from "vitest";
import {
  EMAIL_CODE_LENGTH,
  emailCodeHashesMatch,
  generateEmailCode,
  hashEmailCode,
} from "../../src/modules/auth/email-code.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "s".repeat(32);

describe("generateEmailCode", () => {
  it("is always 6 digits, zero-padded", () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateEmailCode()).toMatch(new RegExp(`^\\d{${EMAIL_CODE_LENGTH}}$`));
    }
  });

  it("is not constant (draws from the whole range)", () => {
    const codes = new Set(Array.from({ length: 200 }, generateEmailCode));
    expect(codes.size).toBeGreaterThan(150);
  });
});

describe("hashEmailCode", () => {
  const hash = hashEmailCode("123456", "verify_email", USER, SECRET);

  it("is a 64-character hex string and is stable", () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmailCode("123456", "verify_email", USER, SECRET)).toBe(hash);
  });

  it.each([
    ["another code", hashEmailCode("654321", "verify_email", USER, SECRET)],
    ["another purpose", hashEmailCode("123456", "reset_password", USER, SECRET)],
    ["another user", hashEmailCode("123456", "verify_email", OTHER_USER, SECRET)],
    ["another secret", hashEmailCode("123456", "verify_email", USER, "t".repeat(32))],
  ])("differs for %s", (_label, other) => {
    expect(other).not.toBe(hash);
  });

  it("does not contain the code", () => {
    expect(hash).not.toContain("123456");
  });
});

describe("emailCodeHashesMatch", () => {
  const hash = hashEmailCode("123456", "verify_email", USER, SECRET);

  it("accepts equal hashes and refuses different or differently sized ones", () => {
    expect(emailCodeHashesMatch(hash, hash)).toBe(true);
    expect(
      emailCodeHashesMatch(hash, hashEmailCode("000000", "verify_email", USER, SECRET)),
    ).toBe(false);
    expect(emailCodeHashesMatch(hash, hash.slice(1))).toBe(false);
    expect(emailCodeHashesMatch(hash, "")).toBe(false);
  });
});
