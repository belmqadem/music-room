import { randomUUID } from "node:crypto";
import type { AuthSession, OAuthProvider, User } from "@music-room/shared";
import type pg from "pg";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./access-token.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateRefreshToken, refreshTokenExpiry } from "./refresh-token.js";
import {
  findLinkedProviders,
  findUserById,
  findUserByEmail,
  insertRefreshToken,
  insertUser,
  isUniqueViolation,
  type UserRecord,
} from "./repository.js";
import type { LoginInput, RegisterInput } from "./schema.js";

export interface AuthServiceDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  /** bcrypt cost; only tests lower it (for speed). Defaults to 12. */
  passwordCost?: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  getUser(userId: string): Promise<User>;
}

type Queryable = Pick<pg.Pool, "query">;

/** Business rules for accounts and sessions. No HTTP and no SQL in here. */
export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const { pool, jwtSecret, passwordCost } = deps;

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
  async function startSession(
    db: Queryable,
    user: UserRecord,
    linkedProviders: string[],
  ): Promise<AuthSession> {
    const refresh = generateRefreshToken();
    await insertRefreshToken(db, {
      userId: user.id,
      familyId: randomUUID(),
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
