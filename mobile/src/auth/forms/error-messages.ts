import { isRequestError } from "@/api/api-error";

// What the user reads when an auth call fails. The backend's codes are stable (docs/api-contract.md,
// "Errors"); the words are ours, so a screen never shows a raw server message it did not expect.

export type AuthAction = "signIn" | "signUp" | "verify" | "resend" | "forgot" | "reset";
export type FieldName = "email" | "password" | "displayName" | "code" | "newPassword";

export interface FormErrors {
  /** Shown above the main button. */
  form: string | null;
  /** Shown under a field. */
  fields: Partial<Record<FieldName, string>>;
}

const FIELDS: readonly FieldName[] = [
  "email",
  "password",
  "displayName",
  "code",
  "newPassword",
];

export const MESSAGES = {
  network: "Can't reach the server. Check your connection and the server address.",
  server: "Something went wrong on our side. Try again in a moment.",
  rateLimited: "Too many attempts. Wait a few minutes, then try again.",
  wrongCredentials: "Email or password is incorrect.",
  notVerified:
    "Confirm your email first: enter the code we sent you, or ask for a new one.",
  emailTaken: "An account already uses this email. Sign in instead.",
  wrongCode: "That code is wrong or has expired. Ask for a new one.",
  checkFields: "Check the highlighted fields.",
} as const;

/** The client-side checks of a form, keeping only the fields that failed. */
export function fieldErrors(
  checks: Partial<Record<FieldName, string | null>>,
): FormErrors["fields"] {
  const fields: FormErrors["fields"] = {};
  for (const [field, message] of Object.entries(checks) as [FieldName, string | null][]) {
    if (message) fields[field] = message;
  }
  return fields;
}

const only = (form: string | null, fields: FormErrors["fields"] = {}): FormErrors => ({
  form,
  fields,
});

/** Turns a failed call into messages for the form that made it. */
export function formErrorsFrom(error: unknown, action: AuthAction): FormErrors {
  if (!isRequestError(error)) return only(MESSAGES.server);

  switch (error.code) {
    case "NETWORK_ERROR":
      return only(MESSAGES.network);
    case "RATE_LIMITED":
      return only(MESSAGES.rateLimited);
    case "INVALID_CREDENTIALS":
      return only(MESSAGES.wrongCredentials);
    case "EMAIL_NOT_VERIFIED":
      return only(MESSAGES.notVerified);
    case "EMAIL_TAKEN":
      return only(null, { email: MESSAGES.emailTaken });
    case "INVALID_CODE":
      return only(null, { code: MESSAGES.wrongCode });
    case "VALIDATION_ERROR": {
      // The backend lists each broken rule as { path, message }; put each under its field.
      const fields: FormErrors["fields"] = {};
      const details = Array.isArray(error.details) ? error.details : [];
      for (const detail of details as { path?: unknown; message?: unknown }[]) {
        const field = FIELDS.find((name) => name === detail.path);
        if (field && typeof detail.message === "string") {
          fields[field] = fields[field]
            ? `${fields[field]} ${detail.message}`
            : detail.message;
        }
      }
      return only(MESSAGES.checkFields, fields);
    }
    default:
      // Includes INTERNAL_ERROR, INVALID_RESPONSE and anything new. Never a raw message.
      void action;
      return only(MESSAGES.server);
  }
}
