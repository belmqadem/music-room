import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";

// What to tell the owner when an invitation call or the people search fails, from the stable code.

export const INVITATION_MESSAGES = {
  ownerOnly: "Only the owner can manage invitations.",
  gone: "This no longer exists, or you can no longer see it.",
  personGone: "This person's account no longer exists.",
  cannotInvite:
    "You can't invite this person (for example, yourself: the owner always has access).",
  unknown: "Something went wrong. Try again.",
} as const;

export function invitationErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return INVITATION_MESSAGES.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
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
