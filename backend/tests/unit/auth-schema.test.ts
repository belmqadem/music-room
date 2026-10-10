import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../../src/modules/auth/schema.js";

const validRegistration = {
  email: "bob@example.com",
  password: "correct horse",
  displayName: "Bob",
};

describe("registerSchema", () => {
  it("accepts a valid body", () => {
    expect(registerSchema.parse(validRegistration)).toEqual(validRegistration);
  });

  it("trims and lowercases the email", () => {
    const parsed = registerSchema.parse({
      ...validRegistration,
      email: "  Bob@Example.COM ",
    });

    expect(parsed.email).toBe("bob@example.com");
  });

  it("trims the display name", () => {
    expect(
      registerSchema.parse({ ...validRegistration, displayName: "  Bob  " }).displayName,
    ).toBe("Bob");
  });

  it("does not trim the password (spaces may be intended)", () => {
    expect(
      registerSchema.parse({ ...validRegistration, password: " spaced pw " }).password,
    ).toBe(" spaced pw ");
  });

  it.each([
    ["no email", { password: "correct horse", displayName: "Bob" }],
    ["no password", { email: "bob@example.com", displayName: "Bob" }],
    ["no display name", { email: "bob@example.com", password: "correct horse" }],
    ["an invalid email", { ...validRegistration, email: "not-an-email" }],
    [
      "an email over 254 characters",
      { ...validRegistration, email: `${"a".repeat(250)}@x.io` },
    ],
    ["a password under 8 bytes", { ...validRegistration, password: "short12" }],
    ["a password over 72 bytes", { ...validRegistration, password: "a".repeat(73) }],
    ["an empty display name", { ...validRegistration, displayName: "   " }],
    [
      "a display name over 50 characters",
      { ...validRegistration, displayName: "x".repeat(51) },
    ],
    ["a non-string password", { ...validRegistration, password: 12345678 }],
    ["an unknown field", { ...validRegistration, isAdmin: true }],
  ])("rejects %s", (_label, body) => {
    expect(registerSchema.safeParse(body).success).toBe(false);
  });

  it.each([null, undefined, "text", 42, []])("rejects a body that is %j", (body) => {
    expect(registerSchema.safeParse(body).success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts any non-empty password (no policy leak at login)", () => {
    expect(
      loginSchema.safeParse({ email: "bob@example.com", password: "x" }).success,
    ).toBe(true);
  });

  it("lowercases and trims the email", () => {
    expect(loginSchema.parse({ email: " Bob@Example.com ", password: "x" }).email).toBe(
      "bob@example.com",
    );
  });

  it.each([
    ["no password", { email: "bob@example.com" }],
    ["an empty password", { email: "bob@example.com", password: "" }],
    ["an empty email", { email: "  ", password: "x" }],
    ["an unknown field", { email: "bob@example.com", password: "x", remember: true }],
    ["a huge password", { email: "bob@example.com", password: "a".repeat(1025) }],
  ])("rejects %s", (_label, body) => {
    expect(loginSchema.safeParse(body).success).toBe(false);
  });
});
