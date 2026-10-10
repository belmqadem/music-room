import { randomUUID } from "node:crypto";
import type { AuthSession, OAuthProvider, User } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./access-token.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from "./refresh-token.js";
import {
  consumeRefreshToken,
  findLinkedProviders,
  findRefreshToken,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  insertUser,
  isUniqueViolation,
  revokeFamily,
  revokeFamilyOfUsersToken,
  type UserRecord,
} from "./repository.js";
import type { LoginInput, RefreshTokenBody, RegisterInput } from "./schema.js";

export interface AuthServiceDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  logger: Logger;
  /** bcrypt cost; only tests lower it (for speed). Defaults to 12. */
  passwordCost?: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  refresh(input: RefreshTokenBody): Promise<AuthSession>;
  logout(userId: string, input: RefreshTokenBody): Promise<void>;
  getUser(userId: string): Promise<User>;
}

type Queryable = Pick<pg.Pool, "query">;

/** Business rules for accounts and sessions. No HTTP and no SQL in here. */
export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const { pool, jwtSecret, logger, passwordCost } = deps;

  function toApiUser(user: UserRecord, linkedProviders: string[]): User {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      linkedProviders: linkedProviders as OAuthProvider[],
      createdAt: user.createdAt.toISOString(),
    };
  }

  // Starts a new login session: a new "family" of refresh tokens plus an access token.
  // `familyId` is only passed when rotating an existing session (refresh).
  async function startSession(
    db: Queryable,
    user: UserRecord,
    linkedProviders: string[],
    familyId: string = randomUUID(),
  ): Promise<AuthSession> {
    const refresh = generateRefreshToken();
    await insertRefreshToken(db, {
      userId: user.id,
      familyId,
      tokenHash: refresh.hash,
      expiresAt: refreshTokenExpiry(),
    });
    return {
      accessToken: await signAccessToken(user.id, jwtSecret),
      refreshToken: refresh.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toApiUser(user, linkedProviders),
    };
  }

  return {
    async register(input) {
      // Hash BEFORE opening the transaction: bcrypt takes ~250 ms and we do not
      // want to hold a database connection that long.
      const passwordHash = await hashPassword(input.password, passwordCost);
      try {
        return await withTransaction(pool, async (client) => {
          const user = await insertUser(client, {
            email: input.email,
            passwordHash,
            displayName: input.displayName,
          });
          return startSession(client, user, []);
        });
      } catch (error) {
        // Relies on the database's unique index, not a "check then insert":
        // two simultaneous registrations of one email cannot both succeed.
        if (isUniqueViolation(error)) {
          throw new HttpError(
            409,
            "EMAIL_TAKEN",
            "An account with this email already exists.",
          );
        }
        throw error;
      }
    },

    async login(input) {
      const user = await findUserByEmail(pool, input.email);
      // Always run a bcrypt comparison (against a dummy hash if there is no
      // user or no password): unknown email and wrong password take the same
      // time and get the same answer.
      const passwordMatches = await verifyPassword(
        input.password,
        user?.passwordHash ?? null,
      );
      if (!user || !passwordMatches) {
        throw new HttpError(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
        );
      }
      return startSession(pool, user, await findLinkedProviders(pool, user.id));
    },

    async refresh(input) {
      const tokenHash = hashRefreshToken(input.refreshToken);

      // The outcome is decided inside the transaction but the error is thrown
      // AFTER it commits: if we threw inside, the "revoke the family" below
      // would be rolled back and the defence would silently not happen.
      const outcome = await withTransaction(pool, async (client) => {
        const consumed = await consumeRefreshToken(client, tokenHash);
        if (consumed) {
          const user = await findUserById(client, consumed.userId);
          if (!user) return { kind: "invalid" } as const;
          const providers = await findLinkedProviders(client, user.id);
          // Same family: it is still the same login session, just a newer token.
          const session = await startSession(client, user, providers, consumed.familyId);
          return { kind: "ok", session } as const;
        }

        // Could not consume. Why? A token that was ALREADY used is the danger
        // sign: either a thief replays a stolen token, or the real client
        // retried. Strict policy: revoke the whole family either way.
        const existing = await findRefreshToken(client, tokenHash);
        if (existing?.usedAt) {
          await revokeFamily(client, existing.familyId);
          return {
            kind: "reuse",
            userId: existing.userId,
            familyId: existing.familyId,
          } as const;
        }
        return { kind: "invalid" } as const; // unknown, expired or already revoked
      });

      if (outcome.kind === "ok") return outcome.session;
      if (outcome.kind === "reuse") {
        // Security event. Log who/which session, never the token.
        logger.warn(
          { userId: outcome.userId, familyId: outcome.familyId },
          "refresh token reuse detected, session revoked",
        );
      }
      // Same answer for every failure: the client learns nothing about why.
      throw new HttpError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Refresh token is invalid or expired.",
      );
    },

    async logout(userId, input) {
      // Always succeeds (idempotent, and no hint about whether the token existed).
      await revokeFamilyOfUsersToken(pool, hashRefreshToken(input.refreshToken), userId);
    },

    async getUser(userId) {
      const user = await findUserById(pool, userId);
      if (!user) {
        // Valid token for a user that no longer exists.
        throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      }
      return toApiUser(user, await findLinkedProviders(pool, user.id));
    },
  };
}
