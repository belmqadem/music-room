import { z } from "zod";
import { isPasswordAcceptable, passwordStrengthViolations } from "./password.js";

// Request body validation for the auth endpoints (docs/api-contract.md).
// z.strictObject rejects unknown fields instead of ignoring them.

// Emails are trimmed and lowercased so "Bob@x.com" and "bob@x.com " are one account.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

// Length first; the strength rules only run on a well-sized password, and each
// broken rule is reported so the client can show all of them at once.
export const newPassword = z
  .string()
  .refine(isPasswordAcceptable, "Password must be 8 to 72 bytes long.")
  .check((ctx) => {
    if (!isPasswordAcceptable(ctx.value)) return;
    for (const message of passwordStrengthViolations(ctx.value)) {
      ctx.issues.push({ code: "custom", message, input: ctx.value });
    }
  });

export const registerSchema = z.strictObject({
  email,
  password: newPassword,
  displayName: z.string().trim().min(1).max(50),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// Login is deliberately lenient on the password (no length policy): the answer
// to a wrong password must not reveal anything about the rules or the account.
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Body of POST /auth/refresh and POST /auth/logout. Tokens are 43 characters;
// the generous max only exists to reject absurd payloads early.
export const refreshTokenBodySchema = z.strictObject({
  refreshToken: z.string().min(1).max(512),
});
export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;

export const oauthProviderSchema = z.enum(["google", "facebook"]);

// Body of POST /auth/oauth/{provider} and POST /users/me/providers/{provider}.
// A Google ID token is about 1 to 2 KB; the max only rejects absurd payloads.
export const oauthBodySchema = z.strictObject({
  credential: z.string().min(1).max(4096),
});
export type OAuthBody = z.infer<typeof oauthBodySchema>;

// Codes are 6 digits. Other shapes are rejected here so nothing odd reaches the hash.
const emailCode = z.string().regex(/^\d{6}$/, "The code is 6 digits.");

// Bodies of the email-code endpoints (ADR-022). Resend and forgot take only an email.
export const verifyEmailSchema = z.strictObject({ email, code: emailCode });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const emailOnlySchema = z.strictObject({ email });
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;

// The new password follows the same policy as register.
export const resetPasswordSchema = z.strictObject({
  email,
  code: emailCode,
  newPassword,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
