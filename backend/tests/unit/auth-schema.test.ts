import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../../src/modules/auth/schema.js";

const validRegistration = {
  email: "bob@example.com",
  password: "Correct-Horse-9",
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
      registerSchema.parse({ ...validRegistration, password: " Spaced pw 1! " }).password,
    ).toBe(" Spaced pw 1! ");
  });

  it.each([
    ["no email", { password: "Correct-Horse-9", displayName: "Bob" }],
    ["no password", { email: "bob@example.com", displayName: "Bob" }],
    ["no display name", { email: "bob@example.com", password: "Correct-Horse-9" }],
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

  describe("password strength", () => {
    const messagesFor = (password: string): string[] => {
      const result = registerSchema.safeParse({ ...validRegistration, password });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };

    it.each([
      [
        "no uppercase letter",
        "correct-horse-9",
        "Password must contain an uppercase letter.",
      ],
      [
        "no lowercase letter",
        "CORRECT-HORSE-9",
        "Password must contain a lowercase letter.",
      ],
      ["no digit", "Correct-Horse-x", "Password must contain a digit."],
      ["no symbol", "CorrectHorse99", "Password must contain a symbol."],
      ["only spaces as a symbol", "Correct Horse 9", "Password must contain a symbol."],
    ])("rejects a password with %s", (_label, password, message) => {
      expect(messagesFor(password)).toEqual([message]);
    });

    it("reports every broken rule at once", () => {
      expect(messagesFor("aaaaaaaa")).toEqual([
        "Password must contain an uppercase letter.",
        "Password must contain a digit.",
        "Password must contain a symbol.",
      ]);
    });

    it("reports only the length rule for a too-short password", () => {
      expect(messagesFor("aB1!")).toEqual(["Password must be 8 to 72 bytes long."]);
    });

    it("accepts exactly 8 bytes when every rule is met", () => {
      expect(messagesFor("aB1!aB1!")).toEqual([]);
    });

    it("counts non-Latin letters and symbols (unicode)", () => {
      expect(messagesFor("éLève-42")).toEqual([]);
      expect(messagesFor("Passw0rd€")).toEqual([]);
    });

    it("does not leak the submitted password in the messages", () => {
      expect(messagesFor("aaaaaaaa").join(" ")).not.toContain("aaaaaaaa");
    });
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
