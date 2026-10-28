import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { Redis } from "ioredis";
import { RedisStore } from "rate-limit-redis";
import { HttpError } from "../http-error.js";

export interface RateLimitSettings {
  windowMs: number;
  limit: number;
}

// Proposed values (docs/api-contract.md): enough for a person who mistypes,
// too few for password guessing. Counted per client IP address.
export const DEFAULT_LOGIN_LIMIT: RateLimitSettings = {
  windowMs: 15 * 60 * 1000,
  limit: 10,
};
export const DEFAULT_REGISTER_LIMIT: RateLimitSettings = {
  windowMs: 60 * 60 * 1000,
  limit: 10,
};
// Sending a friend request. Each one notifies someone else, so a script could harass people with
// them; a person adding friends sends a handful an hour.
export const DEFAULT_FRIEND_REQUEST_LIMIT: RateLimitSettings = {
  windowMs: 60 * 60 * 1000,
  limit: 30,
};

// The four email-code endpoints (verify, resend, forgot, reset) share one counter per IP. The
// real protection against guessing is the per-code limit of 5 tries (ADR-022); this only keeps
// one address from flooding the mail server or hammering many accounts.
export const DEFAULT_EMAIL_CODE_LIMIT: RateLimitSettings = {
  windowMs: 15 * 60 * 1000,
  limit: 20,
};
// Refresh tokens are 256-bit random values, so guessing is hopeless; this only
// stops hammering. Generous because many users can share one IP (mobile networks).
export const DEFAULT_REFRESH_LIMIT: RateLimitSettings = {
  windowMs: 15 * 60 * 1000,
  limit: 100,
};

// The user directory search (invite screen). A person typing searches a few
// times a minute; a script walking the directory searches thousands.
export const DEFAULT_USER_SEARCH_LIMIT: RateLimitSettings = {
  windowMs: 60 * 1000,
  limit: 30,
};

// Catalog search (suggest screen). Every search is one request to Deezer, which has
// its own quota, so this protects that quota as much as our server.
export const DEFAULT_CATALOG_SEARCH_LIMIT: RateLimitSettings = {
  windowMs: 60 * 1000,
  limit: 30,
};

// Track previews (ADR-053): one catalog request each, pressed play by play. A person listening
// through a queue or a search presses play a few times a minute, rarely more than 60.
export const DEFAULT_TRACK_PREVIEW_LIMIT: RateLimitSettings = {
  windowMs: 60 * 1000,
  limit: 60,
};

// Suggesting a track (one catalog request each). Voting is not limited here: a vote is
// idempotent and cheap; a per-user vote limit belongs to the load-test work.
export const DEFAULT_SUGGEST_LIMIT: RateLimitSettings = {
  windowMs: 60 * 1000,
  limit: 30,
};

// Adding a track to a playlist (one catalog request each). Moves and removals are cheap
// and need no catalog, so they are not limited here.
export const DEFAULT_PLAYLIST_ADD_LIMIT: RateLimitSettings = {
  windowMs: 60 * 1000,
  limit: 30,
};

/**
 * Limits requests per IP. With `redis`, counters live in Redis (shared by all
 * server processes, survive restarts); without it they are in memory (tests).
 * If Redis is unreachable the request fails (500) rather than skipping the
 * limit: for login protection, failing closed is the safer default.
 * Behind a reverse proxy, configure Express "trust proxy" or every user will
 * share the proxy's IP (TODO at deployment).
 */
export function createRateLimiter(
  name: string,
  settings: RateLimitSettings,
  redis?: Redis,
): RequestHandler {
  return rateLimit({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: "draft-7", // sends RateLimit-* and Retry-After headers
    legacyHeaders: false,
    ...(redis
      ? {
          store: new RedisStore({
            prefix: `rate-limit:${name}:`,
            sendCommand: (...args: string[]) =>
              redis.call(args[0]!, ...args.slice(1)) as Promise<never>,
          }),
        }
      : {}),
    handler: (_req, _res, next) => {
      next(new HttpError(429, "RATE_LIMITED", "Too many attempts. Try again later."));
    },
  });
}
