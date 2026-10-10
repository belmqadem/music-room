import type { RequestHandler } from "express";
import { AccessTokenError, verifyAccessToken } from "../modules/auth/access-token.js";
import { HttpError } from "../http-error.js";

// After this middleware, protected handlers can read `req.auth.userId`.
declare module "express-serve-static-core" {
  interface Request {
    auth?: { userId: string };
  }
}

/**
 * AUTHENTICATION ("who is calling?"): requires `Authorization: Bearer <access token>`.
 * It does NOT decide whether the caller may touch a given resource; that is
 * authorization and is checked separately in each handler/service.
 * Note: a deleted user's token stays valid until it expires (15 minutes max).
 */
export function createAuthenticate(jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const match = /^Bearer (\S+)$/i.exec(req.get("authorization") ?? "");
    if (!match?.[1]) {
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    try {
      const { userId } = await verifyAccessToken(match[1], jwtSecret);
      req.auth = { userId };
      next();
    } catch (error) {
      if (error instanceof AccessTokenError && error.reason === "expired") {
        throw new HttpError(401, "TOKEN_EXPIRED", "Access token expired.");
      }
      if (error instanceof AccessTokenError) {
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      }
      throw error;
    }
  };
}
