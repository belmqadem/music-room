import type { SetDisplayNameRequest, User } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";
import { auth } from "@/auth";

// The username (the API's `displayName`, ADR-046): the unique name people find you by, chosen
// after sign-up and changeable in Settings. These checks mirror the backend's (auth/schema.ts) so
// the answer comes before the network, and a test runs them against the backend's own schema.
// The server still decides, and only it knows whether a name is taken.

const MIN = 3;
const MAX = 20;
const ALLOWED = /^[a-z0-9._]*$/;
/** Kept for the temporary names of new accounts (`user_` and 12 hex digits). */
const RESERVED_PREFIX = "user_";

/** As the server stores it: trimmed and lowercased, so "Ada " is "ada". */
export const normalizeUsername = (raw: string): string => raw.trim().toLowerCase();

/** What is wrong with the name, most useful first; null when the server would accept its shape. */
export function usernameError(raw: string): string | null {
  const name = normalizeUsername(raw);
  const errors = copy.username.errors;
  if (name.length === 0) return errors.empty;
  if (!ALLOWED.test(name)) return errors.characters;
  if (!/^[a-z]/.test(name)) return errors.firstLetter;
  if (name.length < MIN || name.length > MAX) return errors.length(MIN, MAX);
  if (name.startsWith(RESERVED_PREFIX)) return errors.reserved;
  return null;
}

/**
 * Chooses or changes the username, then refreshes the session: the new access token says the
 * name is set, which the server needs before it lets the account in anywhere else.
 */
export async function saveUsername(raw: string): Promise<User> {
  const body: SetDisplayNameRequest = { displayName: normalizeUsername(raw) };
  const user = await auth.request<User>("PUT", "/users/me/display-name", { body });
  await auth.refreshAccessToken();
  return user;
}

/** What to say when saving fails, from the code; never the server's own message. */
export function usernameSaveErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return copy.errors.unknown;
  switch (error.code) {
    case "DISPLAY_NAME_TAKEN":
      return copy.username.errors.taken;
    // The checks above match the server's, so this means the two disagree: say so plainly.
    case "VALIDATION_ERROR":
      return copy.username.errors.rejected;
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    default:
      return error.status >= 500 ? MESSAGES.server : copy.errors.unknown;
  }
}
