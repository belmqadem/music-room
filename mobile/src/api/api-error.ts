import type { ApiErrorCode } from "@music-room/shared";

// What the app switches on when a call fails. The backend's codes (docs/api-contract.md, "Errors")
// plus two that only exist on the phone: the server could not be reached, or it answered nonsense.
export type RequestErrorCode = ApiErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

export class RequestError extends Error {
  constructor(
    /** HTTP status; 0 when no answer arrived at all. */
    readonly status: number,
    readonly code: RequestErrorCode,
    message: string,
    /** The backend's `details` (for example the failed fields of a VALIDATION_ERROR). */
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError;
}
