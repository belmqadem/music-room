// API contract: error body returned for every non-2xx response. Changes need review from BOTH developers.
// See docs/api-contract.md ("Errors").

// Stable codes the app can switch on. Extend as endpoints are added.
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "FORBIDDEN"
  | "ROOM_NOT_FOUND"
  | "EMAIL_TAKEN"
  | "ALREADY_MEMBER"
  | "RATE_LIMITED";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string; // for humans; may change
    details: unknown; // optional extra data (e.g. failed fields), otherwise null
  };
}
