import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// What to tell the owner when an invitation call or the people search fails, from the stable code.

export const INVITATION_MESSAGES = {
  ...copy.invitations.errors,
  unknown: copy.errors.unknown,
};

export function invitationErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return INVITATION_MESSAGES.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    // ADR-048: the server refuses a Premium feature to a Free user.
    case "PREMIUM_REQUIRED":
      return copy.plan.required;
    case "FORBIDDEN":
      return INVITATION_MESSAGES.ownerOnly;
    // The event or playlist itself answers with its own code...
    case "EVENT_NOT_FOUND":
    case "PLAYLIST_NOT_FOUND":
      return INVITATION_MESSAGES.gone;
    // ...while a plain NOT_FOUND on an invitation is the person (the backend: "User not found").
    case "NOT_FOUND":
    case "USER_NOT_FOUND":
      return INVITATION_MESSAGES.personGone;
    case "VALIDATION_ERROR":
      return INVITATION_MESSAGES.cannotInvite;
    default:
      return error.status >= 500 ? MESSAGES.server : INVITATION_MESSAGES.unknown;
  }
}
