// API contract: error body returned for every non-2xx response. Changes need review from BOTH developers.
// See docs/api-contract.md ("Errors").

// Stable codes the app can switch on. Extend as endpoints are added.
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "LOCATION_REQUIRED"
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "INVALID_REFRESH_TOKEN"
  | "FORBIDDEN"
  | "NOT_INVITED"
  | "OUTSIDE_VOTING_AREA"
  | "OUTSIDE_VOTING_TIME"
  | "EVENT_NOT_FOUND"
  | "PLAYLIST_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "EMAIL_TAKEN"
  | "PROVIDER_ACCOUNT_LINKED"
  | "LAST_LOGIN_METHOD"
  | "ALREADY_INVITED"
  | "TRACK_ALREADY_QUEUED"
  | "TRACK_NOT_VOTABLE"
  | "ANCHOR_NOT_FOUND"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string; // for humans; may change
    details: unknown; // optional extra data (e.g. failed fields), otherwise null
  };
}
