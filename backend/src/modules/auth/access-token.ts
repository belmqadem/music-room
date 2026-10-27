import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

// Access tokens (ADR-003, ADR-006): JWT, 15 minutes, HS256.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "music-room";
const ALGORITHM = "HS256";

export class AccessTokenError extends Error {
  /** "expired" maps to TOKEN_EXPIRED (the app should refresh); "invalid" to UNAUTHENTICATED. */
  constructor(public readonly reason: "expired" | "invalid") {
    super(`Access token ${reason}`);
    this.name = "AccessTokenError";
  }
}

const userIdSchema = z.uuid();

/**
 * What the token says besides who you are. `displayNameSet` (claim `dns`, ADR-046) lets every
 * request refuse an account that has not chosen its display name, without a database read. It
 * can only go from false to true; the app gets a new token (refresh) right after choosing.
 */
export interface AccessClaims {
  displayNameSet: boolean;
}

function toKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  userId: string,
  secret: string,
  claims: AccessClaims,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ dns: claims.displayNameSet })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(toKey(secret));
}

/**
 * Verifies signature, expiry and issuer and returns the user id and the claims. A token without
 * `dns: true` (including one issued before the claim existed) counts as "no display name yet".
 * The algorithm is pinned to HS256: a token claiming another algorithm (or
 * "none") is rejected, which blocks algorithm-confusion attacks.
 * @throws AccessTokenError
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ userId: string } & AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, toKey(secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      currentDate: now,
      requiredClaims: ["sub", "exp", "iat"],
    });
    const parsed = userIdSchema.safeParse(payload.sub);
    if (!parsed.success) throw new AccessTokenError("invalid");
    return { userId: parsed.data, displayNameSet: payload["dns"] === true };
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    if (error instanceof errors.JWTExpired) throw new AccessTokenError("expired");
    throw new AccessTokenError("invalid");
  }
}
