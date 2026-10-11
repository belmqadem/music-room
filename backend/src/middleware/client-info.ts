import type { RequestHandler } from "express";

export interface ClientInfo {
  platform: "ios" | "android" | "web" | "unknown";
  device: string;
  appVersion: string;
}

declare module "express-serve-static-core" {
  interface Request {
    client?: ClientInfo;
  }
}

const PLATFORMS = ["ios", "android", "web"] as const;
const MAX_LENGTH = 64;
// Letters, digits, space and a few separators found in device models and
// versions ("iPhone 15 Pro", "SM-S918B", "1.2.3-beta+4"). Everything else,
// notably newlines and quotes, is dropped so a client cannot forge log lines.
const UNSAFE_CHARACTERS = /[^\p{L}\p{N} ._+\-()]/gu;

function clean(raw: string | undefined): string {
  const value = (raw ?? "").replace(UNSAFE_CHARACTERS, "").trim().slice(0, MAX_LENGTH);
  return value === "" ? "unknown" : value;
}

/**
 * Reads X-Platform, X-Device and X-App-Version for LOGGING ONLY. A client can
 * send anything, so these values must never be used for authorization.
 * Missing or malformed values become "unknown"; the request is never rejected.
 */
export function parseClientInfo(get: (name: string) => string | undefined): ClientInfo {
  const platform = clean(get("x-platform")).toLowerCase();
  return {
    platform: PLATFORMS.find((known) => known === platform) ?? "unknown",
    device: clean(get("x-device")),
    appVersion: clean(get("x-app-version")),
  };
}

export const attachClientInfo: RequestHandler = (req, _res, next) => {
  req.client = parseClientInfo((name) => req.get(name));
  next();
};
