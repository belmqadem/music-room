import type { ApiErrorCode } from "@music-room/shared";

/**
 * An error that maps directly to an API error response (see "Errors" in
 * docs/api-contract.md). Services throw it; the error handler middleware turns
 * it into `{ error: { code, message, details } }` with the right HTTP status.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
