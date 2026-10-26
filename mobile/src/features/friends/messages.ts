import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// What to tell the user when a friends call fails, from the stable code (docs/api-contract.md,
// "Friends"); never the server's message as is. After a conflict the screen reads the state again,
// so the message only says what happened.
export function friendsErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return copy.errors.unknown;
  const errors = copy.friends.errors;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    case "FRIEND_REQUEST_EXISTS":
      return errors.alreadyAsked;
    case "ALREADY_FRIENDS":
      return errors.alreadyFriends;
    case "FRIENDSHIP_NOT_FOUND":
      return errors.requestGone;
    case "USER_NOT_FOUND":
      return errors.personGone;
    case "FORBIDDEN":
      return errors.onlyTheyCanAccept;
    // The only request the app can send that the server refuses as invalid: asking yourself.
    case "VALIDATION_ERROR":
      return errors.notYourself;
    default:
      return error.status >= 500 ? MESSAGES.server : copy.errors.unknown;
  }
}
