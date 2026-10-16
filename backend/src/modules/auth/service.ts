import { randomUUID } from "node:crypto";
import type {
  AuthSession,
  OAuthProvider,
  RegisterResult,
  User,
} from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "./access-token.js";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_COOLDOWN_MS,
  EMAIL_CODE_TTL_MS,
  emailCodeHashesMatch,
  generateEmailCode,
  hashEmailCode,
  type EmailCodePurpose,
} from "./email-code.js";
import type { Mailer } from "./mailer.js";
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
  deleteEmailCode,
  deleteOAuthIdentity,
  deleteUnverifiedUserByEmail,
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
  markEmailVerified,
  revokeAllRefreshTokens,
  revokeFamily,
  revokeFamilyOfUsersToken,
  takeEmailCodeAttempt,
  updatePasswordHash,
  upsertEmailCode,
  violatedConstraint,
  type UserRecord,
} from "./repository.js";
import type {
  EmailOnlyInput,
  LinkProviderInput,
  LoginInput,
  OAuthBody,
  ReauthInput,
  RefreshTokenBody,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from "./schema.js";

export interface AuthServiceDependencies {
  pool: pg.Pool;
  jwtSecret: string;
  logger: Logger;
  /** One verifier per social provider (ADR-011). */
  verifiers: ProviderVerifiers;
  /** Sends the verification and reset codes (ADR-022). */
  mailer: Mailer;
  /** bcrypt cost; only tests lower it (for speed). Defaults to 12. */
  passwordCost?: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<RegisterResult>;
  verifyEmail(input: VerifyEmailInput): Promise<void>;
  resendVerification(input: EmailOnlyInput): Promise<void>;
  forgotPassword(input: EmailOnlyInput): Promise<void>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  login(input: LoginInput): Promise<AuthSession>;
  refresh(input: RefreshTokenBody): Promise<AuthSession>;
  logout(userId: string, input: RefreshTokenBody): Promise<void>;
  getUser(userId: string): Promise<User>;
  oauthLogin(provider: OAuthProvider, input: OAuthBody): Promise<AuthSession>;
  linkProvider(
    userId: string,
    provider: OAuthProvider,
    input: LinkProviderInput,
  ): Promise<User>;
  unlinkProvider(
    userId: string,
    provider: OAuthProvider,
    reauth: ReauthInput,
  ): Promise<User>;
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
  const { pool, jwtSecret, logger, verifiers, mailer, passwordCost } = deps;

  function toApiUser(user: UserRecord, linkedProviders: string[]): User {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      linkedProviders: linkedProviders as OAuthProvider[],
      createdAt: user.createdAt.toISOString(),
    };
  }

  const CODE_MESSAGES: Record<EmailCodePurpose, { subject: string; intro: string }> = {
    verify_email: {
      subject: "Confirm your Music Room email",
      intro: "Your Music Room confirmation code is:",
    },
    reset_password: {
      subject: "Reset your Music Room password",
      intro: "Your Music Room password reset code is:",
    },
  };

  // Creates a code, stores its keyed hash and emails it. A second code inside the cooldown is
  // silently skipped (the caller's answer must not reveal it). The email is sent WITHOUT
  // waiting for the mail server, so the response time says nothing about the account, and a
  // slow or failing mail server cannot fail or delay the request; failures are only logged.
  async function issueCode(
    user: { id: string; email: string },
    purpose: EmailCodePurpose,
  ): Promise<void> {
    const code = generateEmailCode();
    const stored = await upsertEmailCode(pool, {
      userId: user.id,
      purpose,
      codeHash: hashEmailCode(code, purpose, user.id, jwtSecret),
      expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS),
      cooldownMs: EMAIL_CODE_RESEND_COOLDOWN_MS,
    });
    if (!stored) return;
    const { subject, intro } = CODE_MESSAGES[purpose];
    const minutes = EMAIL_CODE_TTL_MS / 60_000;
    mailer
      .send({
        to: user.email,
        subject,
        text: `${intro}\n\n${code}\n\nIt works once and expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
      })
      .catch((error: unknown) => {
        // Never log the message: it holds the code.
        logger.error(
          { userId: user.id, purpose, reason: (error as Error).message },
          "could not send email code",
        );
      });
  }

  // Checks a code and, if it is right, runs `apply` in the SAME transaction, so the code is
  // spent only if its effect happened. Every failure (unknown email, no code, expired, too many
  // tries, wrong code) returns false and is reported the same way. The try is counted and
  // committed even when the code is wrong: the failed outcome is returned, not thrown, because
  // an error thrown inside the transaction would roll the count back.
  async function redeemCode(
    email: string,
    purpose: EmailCodePurpose,
    code: string,
    apply: (client: pg.PoolClient, user: UserRecord) => Promise<void>,
  ): Promise<void> {
    const user = await findUserByEmail(pool, email);
    const accepted =
      user !== null &&
      (await withTransaction(pool, async (client) => {
        const expected = await takeEmailCodeAttempt(
          client,
          user.id,
          purpose,
          EMAIL_CODE_MAX_ATTEMPTS,
        );
        if (expected === null) return false;
        const actual = hashEmailCode(code, purpose, user.id, jwtSecret);
        if (!emailCodeHashesMatch(expected, actual)) return false;
        // False when a simultaneous correct submission spent it first.
        if (!(await deleteEmailCode(client, user.id, purpose, expected))) return false;
        await apply(client, user);
        return true;
      }));
    if (!accepted) {
      throw new HttpError(400, "INVALID_CODE", "The code is invalid or has expired.");
    }
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

  // SECURITY (ADR-025): linking or unlinking a login method changes who can get into the account
  // for good, so a valid access token alone is not enough (it may be stolen and lives 15 minutes).
  // The caller must also prove they own the account with a login method it ALREADY has: its
  // password, or a fresh credential from a provider that is already linked to it.
  async function proveOwnership(userId: string, reauth: ReauthInput): Promise<void> {
    const refused = () =>
      new HttpError(
        403,
        "REAUTH_FAILED",
        "We could not confirm it is you. Check your password or sign in with a linked account again.",
      );
    if (reauth.method === "password") {
      const user = await findUserById(pool, userId);
      // A bcrypt comparison always runs, as in login: an account without a password takes as
      // long as a wrong password.
      const matches = await verifyPassword(reauth.password, user?.passwordHash ?? null);
      // The token is valid but the user was deleted since: a session problem, not a wrong proof.
      if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required.");
      if (!matches) {
        logger.warn({ userId, method: "password" }, "re-authentication failed");
        throw refused();
      }
      return;
    }
    let identity: ProviderIdentity;
    try {
      identity = await verifyWithProvider(reauth.provider, reauth.credential);
    } catch (error) {
      // A bad credential here is a failed proof (403), not a bad session (401): the app must
      // not take it for an expired access token and start a refresh loop.
      if (error instanceof HttpError && error.code === "INVALID_PROVIDER_CREDENTIAL") {
        logger.warn({ userId, method: "provider" }, "re-authentication failed");
        throw refused();
      }
      throw error;
    }
    // The credential must belong to a social account linked to THIS user, not just to someone.
    const owner = await findUserByIdentity(
      pool,
      reauth.provider,
      identity.providerUserId,
    );
    if (owner?.id !== userId) {
      logger.warn({ userId, method: "provider" }, "re-authentication failed");
      throw refused();
    }
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
      if (identity.verifiedEmail) {
        const sameEmail = await findUserByEmail(client, identity.verifiedEmail);
        if (sameEmail && !sameEmail.emailVerifiedAt) {
          // Someone registered this address with a password but never proved they own it,
          // and the provider has just proved that THIS person does. That account could never
          // log in, so it holds nothing: remove it instead of locking the real owner out
          // (ADR-022). A verified account is never touched.
          await deleteUnverifiedUserByEmail(client, identity.verifiedEmail);
          logger.warn(
            { provider, removedUserId: sameEmail.id },
            "removed an unverified account that held a provider-verified email",
          );
        } else if (sameEmail) {
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
      }
      const user = await insertSocialUser(client, {
        email: identity.verifiedEmail,
        displayName: displayNameFrom(identity.displayName),
        emailVerified: identity.verifiedEmail !== null,
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
      let user: UserRecord;
      try {
        user = await insertUser(pool, {
          email: input.email,
          passwordHash,
          displayName: input.displayName,
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
      // No session yet: the address must be proven first (ADR-022).
      await issueCode({ id: user.id, email: input.email }, "verify_email");
      return { email: input.email };
    },

    async verifyEmail(input) {
      await redeemCode(input.email, "verify_email", input.code, (client, user) =>
        markEmailVerified(client, user.id),
      );
    },

    // Answers the same whether or not the account exists, so it cannot be used to find out
    // who is registered. Social-only accounts have no password to confirm, so nothing is sent.
    async resendVerification(input) {
      const user = await findUserByEmail(pool, input.email);
      if (user?.email && user.passwordHash && !user.emailVerifiedAt) {
        await issueCode({ id: user.id, email: user.email }, "verify_email");
      }
    },

    // Same silence as above. An unverified account may reset too: the code proves the mailbox,
    // which also lets the real owner take back an address someone else registered first.
    async forgotPassword(input) {
      const user = await findUserByEmail(pool, input.email);
      if (user?.email && user.passwordHash) {
        await issueCode({ id: user.id, email: user.email }, "reset_password");
      }
    },

    async resetPassword(input) {
      // Hash first, for the same reason as register.
      const passwordHash = await hashPassword(input.newPassword, passwordCost);
      await redeemCode(
        input.email,
        "reset_password",
        input.code,
        async (client, user) => {
          await updatePasswordHash(client, user.id, passwordHash);
          // The code came from the mailbox, so the address is proven now too.
          await markEmailVerified(client, user.id);
          // Whoever knew the old password (or stole a session) is logged out everywhere.
          await revokeAllRefreshTokens(client, user.id);
        },
      );
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
      // Only AFTER the password matched, so this answer never reveals that an address is registered.
      if (!user.emailVerifiedAt) {
        throw new HttpError(
          403,
          "EMAIL_NOT_VERIFIED",
          "Confirm your email with the code we sent before logging in.",
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
      await proveOwnership(userId, input.reauth);
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

    async unlinkProvider(userId, provider, reauth) {
      await proveOwnership(userId, reauth);
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
