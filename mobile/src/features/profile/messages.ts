import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// What to tell the user when a profile call fails, from the stable code (docs/api-contract.md,
// "Profiles"); never the server's message as is.
export function profileErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return copy.errors.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    // The form checks the same rules first, so this means the two disagree: say so plainly.
    case "VALIDATION_ERROR":
      return copy.editProfile.errors.rejected;
    default:
      return error.status >= 500 ? MESSAGES.server : copy.errors.unknown;
  }
}
