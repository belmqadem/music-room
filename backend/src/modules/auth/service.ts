import { randomUUID } from "node:crypto";
import type { AuthSession, OAuthProvider, User } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./access-token.js";
import {
  ProviderCredentialError,
  ProviderUnavailableError,
  type ProviderIdentity,
  type ProviderVerifiers,
} from "./provider-verifier.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
} from "./refresh-token.js";
import {
  consumeRefreshToken,
  deleteOAuthIdentity,
  findLinkedProviders,
  findRefreshToken,
  findUserByEmail,
  findUserByIdentity,
  findUserById,
  insertOAuthIdentity,
  insertRefreshToken,
  insertSocialUser,
  insertUser,
  isForeignKeyViolation,
  isUniqueViolation,
  lockUser,
  revokeFamily,
  revokeFamilyOfUsersToken,
  violatedConstraint,
  type UserRecord,
} from "./repository.js";
import type { LoginInput, OAuthBody, RefreshTokenBody, RegisterInput } from "./schema.js";

export interface AuthServiceDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  logger: Logger;
  /** One verifier per social provider (ADR-011). */
  verifiers: ProviderVerifiers;
  /** bcrypt cost; only tests lower it (for speed). Defaults to 12. */
  passwordCost?: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthSession>;
  login(input: LoginInput): Promise<AuthSession>;
  refresh(input: RefreshTokenBody): Promise<AuthSession>;
  logout(userId: string, input: RefreshTokenBody): Promise<void>;
  getUser(userId: string): Promise<User>;
  oauthLogin(provider: OAuthProvider, input: OAuthBody): Promise<AuthSession>;
  linkProvider(userId: string, provider: OAuthProvider, input: OAuthBody): Promise<User>;
  unlinkProvider(userId: string, provider: OAuthProvider): Promise<User>;
}

// Constraint names from the oauth_identities / users migrations.
const PROVIDER_ACCOUNT_CONSTRAINT = "oauth_identities_provider_account_key";
const USER_PROVIDER_CONSTRAINT = "oauth_identities_user_provider_key";
const EMAIL_CONSTRAINT = "users_email_lower_key";

const DISPLAY_NAME_MAX = 50;
const DEFAULT_DISPLAY_NAME = "Music Room user";

/** The provider's name is untrusted: trim it and cut it to what the database accepts. */
function displayNameFrom(name: string | null): string {
  const trimmed = Array.from(name?.trim() ?? "")
    .slice(0, DISPLAY_NAME_MAX)
    .join("")
    .trim();
  return trimmed === "" ? DEFAULT_DISPLAY_NAME : trimmed;
}

type Queryable = Pick<pg.Pool, "query">;

/** Business rules for accounts and sessions. No HTTP and no SQL in here. */
export function createAuthService(deps: AuthServiceDependencies): AuthService {
  const { pool, jwtSecret, logger, verifiers, passwordCost } = deps;

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

  // Asks the provider who the credential belongs to. Done OUTSIDE any database
  // transaction: it is a network call and must not hold a connection.
  async function verifyWithProvider(
    provider: OAuthProvider,
    credential: string,
  ): Promise<ProviderIdentity> {
    try {
      return await verifiers[provider].verify(credential);
    } catch (error) {
      // Never log the credential. One generic message, whatever the reason.
      if (error instanceof ProviderCredentialError) {
        logger.warn({ provider }, "social credential rejected by provider");
        throw new HttpError(
          401,
          "INVALID_PROVIDER_CREDENTIAL",
          "The social sign-in credential is invalid or expired.",
        );
      }
      if (error instanceof ProviderUnavailableError) {
        logger.error({ provider, reason: error.message }, "social provider unavailable");
        throw new HttpError(
          502,
          "PROVIDER_UNAVAILABLE",
          "The social provider could not be reached. Try again later.",
        );
      }
      throw error;
    }
  }

  // Logs in the user a provider account is linked to, or creates a social-only
  // account for it. `created` tells which one happened.
  async function loginOrCreateSocialUser(
    provider: OAuthProvider,
    identity: ProviderIdentity,
  ) {
    return withTransaction(pool, async (client) => {
      const loginAs = async (user: UserRecord) => ({
        session: await startSession(
          client,
          user,
          await findLinkedProviders(client, user.id),
        ),
        created: false,
      });

      const linked = await findUserByIdentity(client, provider, identity.providerUserId);
      if (linked) return loginAs(linked);

      // NO automatic linking by email (ADR-007): the user must log in and link.
      if (
        identity.verifiedEmail &&
        (await findUserByEmail(client, identity.verifiedEmail))
      ) {
        // But that email may belong to the account ANOTHER request has just created
        // for this very provider account (two first logins at the same moment): it
        // committed between our two lookups. Look again: if this provider account is
        // linked now, this is a login, not a conflict. (Its user and its link are
        // committed together, so if we can see one we can see the other.)
        const justLinked = await findUserByIdentity(
          client,
          provider,
          identity.providerUserId,
        );
        if (justLinked) return loginAs(justLinked);
        throw new HttpError(
          409,
          "EMAIL_TAKEN",
          "An account with this email already exists.",
        );
      }
      const user = await insertSocialUser(client, {
        email: identity.verifiedEmail,
        displayName: displayNameFrom(identity.displayName),
      });
      await insertOAuthIdentity(client, {
        userId: user.id,
        provider,
        providerUserId: identity.providerUserId,
      });
      return { session: await startSession(client, user, [provider]), created: true };
    });
  }

  async function getUserById(userId: string): Promise<User> {
    const user = await findUserById(pool, userId);
    if (!user) {
      // Valid token for a user that no longer exists.
      throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
    }
    return toApiUser(user, await findLinkedProviders(pool, user.id));
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
      // Through withTransaction so a deadlock with a concurrent refresh is retried.
      await withTransaction(pool, (client) =>
        revokeFamilyOfUsersToken(client, hashRefreshToken(input.refreshToken), userId),
      );
    },

    getUser: getUserById,

    async oauthLogin(provider, input) {
      const identity = await verifyWithProvider(provider, input.credential);
      let outcome;
      try {
        outcome = await loginOrCreateSocialUser(provider, identity);
      } catch (error) {
        const constraint = violatedConstraint(error);
        if (
          constraint !== PROVIDER_ACCOUNT_CONSTRAINT &&
          constraint !== EMAIL_CONSTRAINT
        ) {
          throw error;
        }
        // Either two first logins of this provider account ran at once and the
        // other one won the unique index, or someone registered this email in
        // the meantime. Our transaction rolled back, so run the whole decision
        // once more: it now logs in as the account the winner created, or
        // refuses with EMAIL_TAKEN if the email belongs to someone else.
        try {
          outcome = await loginOrCreateSocialUser(provider, identity);
        } catch (retryError) {
          if (violatedConstraint(retryError) === EMAIL_CONSTRAINT) {
            throw new HttpError(
              409,
              "EMAIL_TAKEN",
              "An account with this email already exists.",
            );
          }
          throw retryError;
        }
      }
      logger.info(
        { userId: outcome.session.user.id, provider, created: outcome.created },
        "social login",
      );
      return outcome.session;
    },

    async linkProvider(userId, provider, input) {
      const identity = await verifyWithProvider(provider, input.credential);
      try {
        await insertOAuthIdentity(pool, {
          userId,
          provider,
          providerUserId: identity.providerUserId,
        });
      } catch (error) {
        const constraint = violatedConstraint(error);
        if (
          constraint === PROVIDER_ACCOUNT_CONSTRAINT ||
          constraint === USER_PROVIDER_CONSTRAINT
        ) {
          throw new HttpError(
            409,
            "PROVIDER_ACCOUNT_LINKED",
            "This social account is already linked, or you already linked this provider.",
          );
        }
        // The token was valid but the user was deleted since.
        if (isForeignKeyViolation(error)) {
          throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
        }
        throw error;
      }
      logger.info({ userId, provider }, "social account linked");
      return getUserById(userId);
    },

    async unlinkProvider(userId, provider) {
      const user = await withTransaction(pool, async (client) => {
        // Lock first: two simultaneous unlinks queue here, so the second one
        // sees the first one's result and the last method cannot be removed.
        const locked = await lockUser(client, userId);
        if (!locked)
          throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
        const linked = await findLinkedProviders(client, userId);
        if (!linked.includes(provider)) {
          throw new HttpError(
            404,
            "NOT_FOUND",
            "This provider is not linked to your account.",
          );
        }
        const loginMethods = linked.length + (locked.passwordHash ? 1 : 0);
        if (loginMethods <= 1) {
          throw new HttpError(
            409,
            "LAST_LOGIN_METHOD",
            "You cannot remove your only way to log in.",
          );
        }
        await deleteOAuthIdentity(client, userId, provider);
        return toApiUser(
          locked,
          linked.filter((name) => name !== provider),
        );
      });
      logger.info({ userId, provider }, "social account unlinked");
      return user;
    },
  };
}
