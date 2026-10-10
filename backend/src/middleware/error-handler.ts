import type { ApiError } from "@music-room/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { HttpError } from "../http-error.js";

function body(
  code: ApiError["error"]["code"],
  message: string,
  details: unknown = null,
): ApiError {
  return { error: { code, message, details } };
}

/** Unknown route: JSON 404 instead of Express's default HTML page. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND", "Route not found."));
};

/**
 * Last middleware: turns every error into the contract's error body.
 * Unexpected errors are logged in full but the client only sees a generic
 * message, so internals (SQL, stack traces) never leak.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json(body(error.code, error.message, error.details));
      return;
    }
    if (error instanceof ZodError) {
      // Only field path + message: never echo the submitted values (they may be passwords).
      const details = error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      res.status(400).json(body("VALIDATION_ERROR", "Invalid request.", details));
      return;
    }
    // Errors from express.json(): malformed JSON ("entity.parse.failed"), body too large, ...
    const type = (error as { type?: unknown }).type;
    if (typeof type === "string" && type.startsWith("entity.")) {
      res
        .status(400)
        .json(body("VALIDATION_ERROR", "Request body could not be read as JSON."));
      return;
    }
    logger.error({ err: error }, "unhandled error");
    res.status(500).json(body("INTERNAL_ERROR", "Something went wrong."));
  };
}
