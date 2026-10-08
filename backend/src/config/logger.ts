import pino, { type Logger } from "pino";
import type { Config } from "./env.js";

/**
 * Structured (JSON) logger. In development the output is pretty-printed for
 * humans; everywhere else it stays JSON so it can be shipped/queried.
 * The logging module will later add per-request fields (platform, device,
 * app version) on top of this base logger.
 */
export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty" } }
      : {}),
  });
}
