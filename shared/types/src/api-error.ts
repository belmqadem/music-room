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
  | "INVALID_PROVIDER_CREDENTIAL"
  | "REAUTH_FAILED"
  | "FORBIDDEN"
  | "NOT_INVITED"
  | "OUTSIDE_VOTING_AREA"
  | "OUTSIDE_VOTING_TIME"
  | "EVENT_NOT_FOUND"
  | "PLAYLIST_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "EMAIL_TAKEN"
  | "USER_NOT_FOUND"
  | "FRIENDSHIP_NOT_FOUND"
  | "FRIEND_REQUEST_EXISTS"
  | "ALREADY_FRIENDS"
  | "EMAIL_NOT_VERIFIED"
  | "INVALID_CODE"
  | "PROVIDER_ACCOUNT_LINKED"
  | "LAST_LOGIN_METHOD"
  | "ALREADY_INVITED"
  | "TRACK_ALREADY_QUEUED"
  | "TRACK_NOT_VOTABLE"
  | "QUEUE_CHANGED"
  | "ANCHOR_NOT_FOUND"
  | "PLAYLIST_FULL"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string; // for humans; may change
    details: unknown; // optional extra data (e.g. failed fields), otherwise null
  };
}
