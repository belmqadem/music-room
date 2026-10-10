import { z } from "zod";
import { isPasswordAcceptable } from "./password.js";

// Request body validation for the auth endpoints (docs/api-contract.md).
// z.strictObject rejects unknown fields instead of ignoring them.

// Emails are trimmed and lowercased so "Bob@x.com" and "bob@x.com " are one account.
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const registerSchema = z.strictObject({
  email,
  password: z
    .string()
    .refine(isPasswordAcceptable, "Password must be 8 to 72 bytes long."),
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
