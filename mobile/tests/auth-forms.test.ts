/// <reference types="node" />
// Node types for this file only: TypeScript 6 does not load @types automatically, and the app code
// must not see Node globals.
import { beforeEach, describe, expect, it } from "vitest";
import { RequestError } from "@/api/api-error";
import { RESEND_COOLDOWN_SECONDS, secondsUntilResend } from "@/auth/forms/cooldown";
import { fieldErrors, formErrorsFrom, MESSAGES } from "@/auth/forms/error-messages";
import { clearHandoff, handOff, readHandoff, takeNotice } from "@/auth/forms/handoff";
import {
  codeError,
  emailError,
  missingPasswordRules,
  newPasswordError,
  normalizeEmail,
  signInPasswordError,
  utf8Length,
} from "@/auth/forms/validation";
// The backend's own rules, to prove the app agrees with them (tests only; the app never ships these).
import { passwordStrengthViolations } from "../../backend/src/modules/auth/password";
import {
  newPassword as backendNewPassword,
  registerSchema,
} from "../../backend/src/modules/auth/schema";

const PASSWORDS = [
  "",
  "Aa1!",
  "short1!",
  "Password1!",
  "password1!",
  "PASSWORD1!",
  "Password!!",
  "Password12",
  "Pass word1",
  "Pass word1!",
  "Aa1     xyz",
  "Ünïcödé1!",
  "ΩMEGAωmega1!",
  "Пароль123!",
  "パスワードAa1!",
  "Aa٣!xyzw",
  "Aa😀xxxx1",
  "Aa1!" + "x".repeat(68),
  "Aa1!" + "x".repeat(69),
  "Aa1!" + "é".repeat(34),
  "Aa1!" + "é".repeat(35),
  "Aa1!" + "🎵".repeat(17),
  "Aa1!" + "🎵".repeat(18),
];

describe("password rules agree with the backend", () => {
  it.each(PASSWORDS)(
    "%j: accepted by the app exactly when the backend accepts it",
    (password) => {
      expect(newPasswordError(password) === null).toBe(
        backendNewPassword.safeParse(password).success,
      );
    },
  );

  it.each(PASSWORDS.filter((p) => p.length > 0))(
    "%j: the same missing rules",
    (password) => {
      const backend = passwordStrengthViolations(password).map((message) =>
        message.includes("lowercase")
          ? "lowercase"
          : message.includes("uppercase")
            ? "uppercase"
            : message.includes("digit")
              ? "digit"
              : "symbol",
      );

      expect(missingPasswordRules(password)).toEqual(backend);
    },
  );

  it("counts bytes like the backend (bcrypt's limit is in bytes, not characters)", () => {
    for (const text of [...PASSWORDS, "é", "€", "🎵", "á"]) {
      expect(utf8Length(text), JSON.stringify(text)).toBe(
        Buffer.byteLength(text, "utf8"),
      );
    }
  });

  it("explains what is missing in plain words", () => {
    expect(newPasswordError("")).toBe("Choose a password.");
    expect(newPasswordError("Aa1!")).toBe("Use at least 8 characters.");
    expect(newPasswordError("password1!")).toBe("Add an uppercase letter.");
    expect(newPasswordError("password")).toBe(
      "Add an uppercase letter, a digit and a symbol.",
    );
    expect(newPasswordError("Aa1!" + "x".repeat(69))).toMatch(/too long/);
    expect(newPasswordError("Password1!")).toBeNull();
  });

  it("does not apply the rules at sign-in (an old password must still work)", () => {
    expect(signInPasswordError("weak")).toBeNull();
    expect(signInPasswordError("")).toBe("Enter your password.");
  });
});

describe("other fields agree with the backend", () => {
  it("normalizes the email the way the backend stores it", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each(["ada@example.com", "  Ada@Example.com ", "first.last+tag@sub.example.org"])(
    "accepts %j, which the backend accepts too",
    (email) => {
      expect(emailError(email)).toBeNull();
      expect(registerSchema.shape.email.safeParse(email).success).toBe(true);
    },
  );

  it.each(["", "ada", "ada@", "@example.com", "ada@example", "a da@example.com"])(
    "refuses %j",
    (email) => {
      expect(emailError(email)).not.toBeNull();
      expect(registerSchema.shape.email.safeParse(email).success).toBe(false);
    },
  );

  it("wants exactly six digits for a code", () => {
    expect(codeError("123456")).toBeNull();
    expect(codeError(" 123456 ")).toBeNull();
    expect(codeError("")).toBe("Enter the 6-digit code.");
    for (const bad of ["12345", "1234567", "12345a", "12 456"])
      expect(codeError(bad), bad).not.toBeNull();
  });
});

describe("error messages", () => {
  const fail = (status: number, code: string, details: unknown = null) =>
    new RequestError(status, code as RequestError["code"], "raw server text", details);

  it.each([
    ["NETWORK_ERROR", 0, MESSAGES.network],
    ["RATE_LIMITED", 429, MESSAGES.rateLimited],
    ["INVALID_CREDENTIALS", 401, MESSAGES.wrongCredentials],
    ["EMAIL_NOT_VERIFIED", 403, MESSAGES.notVerified],
    ["INTERNAL_ERROR", 500, MESSAGES.server],
    ["INVALID_RESPONSE", 502, MESSAGES.server],
    ["SOMETHING_NEW", 418, MESSAGES.server],
  ])("%s becomes our own message, never the raw server text", (code, status, message) => {
    const errors = formErrorsFrom(fail(status, code), "signIn");

    expect(errors.form).toBe(message);
    expect(JSON.stringify(errors)).not.toContain("raw server text");
  });

  it("a taken email and a wrong code are shown under their field", () => {
    expect(formErrorsFrom(fail(409, "EMAIL_TAKEN"), "signUp")).toEqual({
      form: null,
      fields: { email: MESSAGES.emailTaken },
    });
    expect(formErrorsFrom(fail(400, "INVALID_CODE"), "verify")).toEqual({
      form: null,
      fields: { code: MESSAGES.wrongCode },
    });
  });

  it("puts each validation problem under its field and joins several for one field", () => {
    const errors = formErrorsFrom(
      fail(400, "VALIDATION_ERROR", [
        { path: "password", message: "Password must contain a digit." },
        { path: "password", message: "Password must contain a symbol." },
        { path: "email", message: "Too long." },
        { path: "somethingElse", message: "ignored" },
      ]),
      "signUp",
    );

    expect(errors.form).toBe(MESSAGES.checkFields);
    expect(errors.fields).toEqual({
      password: "Password must contain a digit. Password must contain a symbol.",
      email: "Too long.",
    });
  });

  it("copes with validation details that are missing or not a list", () => {
    expect(formErrorsFrom(fail(400, "VALIDATION_ERROR", null), "reset").fields).toEqual(
      {},
    );
    expect(
      formErrorsFrom(fail(400, "VALIDATION_ERROR", "weird"), "reset").fields,
    ).toEqual({});
  });

  it("anything that is not a request error is a server problem", () => {
    expect(formErrorsFrom(new Error("boom"), "signIn")).toEqual({
      form: MESSAGES.server,
      fields: {},
    });
  });

  it("fieldErrors keeps only the checks that failed", () => {
    expect(
      fieldErrors({ email: null, password: "Enter your password.", code: null }),
    ).toEqual({
      password: "Enter your password.",
    });
  });
});

describe("resend cooldown", () => {
  const sentAt = 1_000_000;

  it("mirrors the backend's 60 seconds, counting down", () => {
    expect(secondsUntilResend(null, sentAt)).toBe(0);
    expect(secondsUntilResend(sentAt, sentAt)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(secondsUntilResend(sentAt, sentAt + 500)).toBe(60);
    expect(secondsUntilResend(sentAt, sentAt + 59_500)).toBe(1);
    expect(secondsUntilResend(sentAt, sentAt + 60_000)).toBe(0);
    expect(secondsUntilResend(sentAt, sentAt + 3_600_000)).toBe(0);
  });

  it("never waits longer than the backend, even if the clock went backwards", () => {
    expect(secondsUntilResend(sentAt, sentAt - 3_600_000)).toBe(RESEND_COOLDOWN_SECONDS);
  });
});

describe("handing the email from one screen to the next", () => {
  beforeEach(() => clearHandoff());

  it("starts empty", () => {
    expect(readHandoff()).toEqual({ email: null, codeSentAt: null, notice: null });
  });

  it("merges what each screen adds", () => {
    handOff({ email: "ada@example.com", codeSentAt: 5 });
    handOff({ notice: "Email confirmed." });

    expect(readHandoff()).toEqual({
      email: "ada@example.com",
      codeSentAt: 5,
      notice: "Email confirmed.",
    });
  });

  it("shows a notice once", () => {
    handOff({ notice: "Password changed." });

    expect(takeNotice()).toBe("Password changed.");
    expect(takeNotice()).toBeNull();
    expect(readHandoff().notice).toBeNull();
  });

  it("forgets everything after a sign-in", () => {
    handOff({ email: "ada@example.com", codeSentAt: 5, notice: "x" });
    clearHandoff();

    expect(readHandoff()).toEqual({ email: null, codeSentAt: null, notice: null });
  });
});
