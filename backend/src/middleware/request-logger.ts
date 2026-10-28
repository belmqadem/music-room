import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "pino";
import { attachClientInfo } from "./client-info.js";

/**
 * Writes one structured log line per finished request, carrying the mobile
 * client's platform, device and app version (subject requirement).
 * Logged: method, path WITHOUT the query string, status, duration, user id.
 * Never logged: headers, bodies or query strings (they can hold passwords and
 * tokens). `userId` is only set when a route ran `authenticate`.
 * Mounted first, so rejected requests (bad JSON, 404, 429) are logged too.
 */
export function createRequestLogger(logger: Logger): RequestHandler[] {
  const log: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = randomUUID();
    res.on("finish", () => {
      const status = res.statusCode;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      logger[req.path === "/health" ? "debug" : level](
        {
          requestId,
          method: req.method,
          path: req.originalUrl.split("?")[0],
          status,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
          userId: req.auth?.userId,
          client: req.client,
        },
        "request completed",
      );
    });
    next();
  };
  return [attachClientInfo, log];
}
