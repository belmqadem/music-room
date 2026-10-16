import { Writable } from "node:stream";
import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createMemoryMailer } from "../helpers/memory-mailer.js";
import { signUpVerified } from "../helpers/sign-up.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import {
  ProviderCredentialError,
  ProviderUnavailableError,
  type ProviderIdentity,
  type ProviderVerifier,
} from "../../src/modules/auth/provider-verifier.js";

// Social login, linking and unlinking against a real, migrated Postgres
// (set TEST_DATABASE_URL; see `make test-integration`). The providers are
// faked: this file tests OUR rules, the verifiers have their own unit tests.
//
// Rules under test (ADR-007, ADR-011):
//  - a linked provider account logs in as its user; an unknown one creates a social-only account;
//  - NO automatic linking by email: a matching verified email is EMAIL_TAKEN;
//  - a user always keeps at least one login method, even under simultaneous unlinks;
//  - a provider account belongs to at most one user.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const EMAIL_DOMAIN = "@oauth-flow.invalid";
const ID_PREFIX = "oauth-flow-";
const PASSWORD = "Correct-Horse-Battery-9";

/** credential -> what the provider would confirm. "bad" is rejected, "down" is unreachable. */
function fakeProvider(known: Record<string, ProviderIdentity>): ProviderVerifier {
  return {
    async verify(credential) {
      if (credential === "down") throw new ProviderUnavailableError("test outage");
      const identity = known[credential];
      if (!identity) throw new ProviderCredentialError();
      return identity;
    },
  };
}

const google = (id: string, extra: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  providerUserId: `${ID_PREFIX}g-${id}`,
  displayName: `Google ${id}`,
  verifiedEmail: `${id}${EMAIL_DOMAIN}`,
  ...extra,
});
const facebook = (
  id: string,
  extra: Partial<ProviderIdentity> = {},
): ProviderIdentity => ({
  providerUserId: `${ID_PREFIX}f-${id}`,
  displayName: `Facebook ${id}`,
  verifiedEmail: null,
  ...extra,
});

interface Session {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    displayName: string;
    emailVerified: boolean;
    linkedProviders: string[];
  };
}

describe.skipIf(!databaseUrl)("social login, link and unlink", () => {
  let pool: pg.Pool;
  let app: Express;
  const mailer = createMemoryMailer();
  let logLines: string[];

  // Credentials the fake providers know about.
  const googleAccounts: Record<string, ProviderIdentity> = {};
  const facebookAccounts: Record<string, ProviderIdentity> = {};

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
    logLines = [];
    app = buildApp();
  });
  afterEach(async () => {
    await pool.query(
      `DELETE FROM users WHERE email LIKE $1
         OR id IN (SELECT user_id FROM oauth_identities WHERE provider_user_id LIKE $2)`,
      [`%${EMAIL_DOMAIN}`, `${ID_PREFIX}%`],
    );
    for (const table of [googleAccounts, facebookAccounts]) {
      for (const key of Object.keys(table)) delete table[key];
    }
    logLines.length = 0;
  });
  afterAll(async () => {
    await pool.end();
  });

  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    const sink = new Writable({
      write(chunk, _encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "info" }, sink),
      passwordCost: 4,
      mailer,
      loginLimit: { windowMs: 60_000, limit: 10_000 },
      registerLimit: { windowMs: 60_000, limit: 10_000 },
      refreshLimit: { windowMs: 60_000, limit: 10_000 },
      emailCodeLimit: { windowMs: 60_000, limit: 10_000 },
      providerVerifiers: {
        google: fakeProvider(googleAccounts),
        facebook: fakeProvider(facebookAccounts),
      },
      ...overrides,
    });
  }

  /** Registers a credential with the fake Google and returns it. */
  function googleCredential(id: string, extra: Partial<ProviderIdentity> = {}): string {
    const credential = `google-token-${id}`;
    googleAccounts[credential] = google(id, extra);
    return credential;
  }
  function facebookCredential(id: string, extra: Partial<ProviderIdentity> = {}): string {
    const credential = `facebook-token-${id}`;
    facebookAccounts[credential] = facebook(id, extra);
    return credential;
  }

  const oauthLogin = (provider: string, body: object, target: Express = app) =>
    request(target).post(`/api/v1/auth/oauth/${provider}`).send(body);
  // Linking and unlinking need proof of ownership (ADR-025). The default proof is the password the
  // test accounts registered with; `null` sends none.
  const withPassword = { method: "password", password: PASSWORD };
  const viaGoogle = (id: string) => ({
    method: "provider",
    provider: "google",
    credential: googleCredential(id),
  });
  const viaFacebook = (id: string) => ({
    method: "provider",
    provider: "facebook",
    credential: facebookCredential(id),
  });
  const link = (
    accessToken: string,
    provider: string,
    body: object,
    reauth: object | null = withPassword,
    target: Express = app,
  ) =>
    request(target)
      .post(`/api/v1/users/me/providers/${provider}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(reauth === null ? body : { ...body, reauth });
  const unlink = (
    accessToken: string,
    provider: string,
    reauth: object | null = withPassword,
    target: Express = app,
  ) =>
    request(target)
      .delete(`/api/v1/users/me/providers/${provider}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(reauth === null ? {} : { reauth });
  const me = (accessToken: string) =>
    request(app).get("/api/v1/users/me").set("Authorization", `Bearer ${accessToken}`);

  async function loginWithGoogle(id: string): Promise<Session> {
    const response = await oauthLogin("google", { credential: googleCredential(id) });
    expect(response.status).toBe(200);
    return response.body as Session;
  }
  async function registerWithPassword(name: string): Promise<Session> {
    const response = await signUpVerified(app, mailer, {
      email: `${name}${EMAIL_DOMAIN}`,
      password: PASSWORD,
      displayName: name,
    });
    return response.body as Session;
  }
  const countUsers = async () =>
    Number(
      (
        await pool.query(
          `SELECT count(*) FROM users WHERE email LIKE $1
             OR id IN (SELECT user_id FROM oauth_identities WHERE provider_user_id LIKE $2)`,
          [`%${EMAIL_DOMAIN}`, `${ID_PREFIX}%`],
        )
      ).rows[0].count,
    );

  describe("POST /auth/oauth/{provider}", () => {
    it("creates a social-only account on the first Google login", async () => {
      const response = await oauthLogin("google", {
        credential: googleCredential("ada"),
      });

      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.user).toMatchObject({
        email: `ada${EMAIL_DOMAIN}`,
        displayName: "Google ada",
        linkedProviders: ["google"],
      });
      expect(response.body.user).not.toHaveProperty("passwordHash");
      const row = await pool.query("SELECT password_hash FROM users WHERE id = $1", [
        response.body.user.id,
      ]);
      expect(row.rows[0].password_hash).toBeNull();
    });

    it("returns a working session: /users/me and refresh both accept it", async () => {
      const session = await loginWithGoogle("ada");

      expect((await me(session.accessToken)).body.id).toBe(session.user.id);
      const refreshed = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: session.refreshToken });
      expect(refreshed.status).toBe(200);
    });

    it("logs the same user in again instead of creating a second account", async () => {
      const first = await loginWithGoogle("ada");
      const second = await loginWithGoogle("ada");

      expect(second.user.id).toBe(first.user.id);
      expect(await countUsers()).toBe(1);
    });

    it("creates a Facebook account without an email", async () => {
      const response = await oauthLogin("facebook", {
        credential: facebookCredential("grace"),
      });

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        email: null,
        displayName: "Facebook grace",
        linkedProviders: ["facebook"],
      });
    });

    it("refuses with EMAIL_TAKEN when the verified email belongs to a password account", async () => {
      await registerWithPassword("taken");

      const response = await oauthLogin("google", {
        credential: googleCredential("other", { verifiedEmail: `taken${EMAIL_DOMAIN}` }),
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("EMAIL_TAKEN");
      expect(await countUsers()).toBe(1);
      const identities = await pool.query(
        "SELECT 1 FROM oauth_identities WHERE provider_user_id LIKE $1",
        [`${ID_PREFIX}%`],
      );
      expect(identities.rowCount).toBe(0);
    });

    it("reports a provider-verified email as verified, and an account without email as not", async () => {
      const withEmail = await loginWithGoogle("verified");
      const withoutEmail = await oauthLogin("facebook", {
        credential: facebookCredential("noemail"),
      });

      expect(withEmail.user.emailVerified).toBe(true);
      expect(withoutEmail.body.user.emailVerified).toBe(false);
    });

    it("removes an UNVERIFIED password account that holds the provider-verified email, so the real owner is not locked out", async () => {
      const squatter = await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: `owner${EMAIL_DOMAIN}`,
          password: PASSWORD,
          displayName: "Squatter",
        });
      expect(squatter.status).toBe(201);

      const response = await oauthLogin("google", {
        credential: googleCredential("other", { verifiedEmail: `owner${EMAIL_DOMAIN}` }),
      });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(true);
      expect(response.body.user.linkedProviders).toEqual(["google"]);
      const rows = await pool.query("SELECT password_hash FROM users WHERE email = $1", [
        `owner${EMAIL_DOMAIN}`,
      ]);
      expect(rows.rows).toEqual([{ password_hash: null }]); // only the social account is left
      const squatterLogin = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: `owner${EMAIL_DOMAIN}`, password: PASSWORD });
      expect(squatterLogin.status).toBe(401);
    });

    it("leaves an unverified account alone when the provider does not vouch for the email", async () => {
      await request(app)
        .post("/api/v1/auth/register")
        .send({
          email: `owner${EMAIL_DOMAIN}`,
          password: PASSWORD,
          displayName: "Pending",
        });

      const response = await oauthLogin("google", {
        credential: googleCredential("other", { verifiedEmail: null }),
      });

      expect(response.status).toBe(200);
      const pending = await pool.query("SELECT 1 FROM users WHERE email = $1", [
        `owner${EMAIL_DOMAIN}`,
      ]);
      expect(pending.rowCount).toBe(1);
    });

    it("matches the email case-insensitively", async () => {
      await registerWithPassword("casey");

      const response = await oauthLogin("google", {
        credential: googleCredential("other", {
          verifiedEmail: `CASEY${EMAIL_DOMAIN.toUpperCase()}`,
        }),
      });

      expect(response.body.error.code).toBe("EMAIL_TAKEN");
    });

    it("does not treat an UNVERIFIED email as a match: it creates a separate account", async () => {
      await registerWithPassword("victim");

      const response = await oauthLogin("google", {
        credential: googleCredential("attacker", { verifiedEmail: null }),
      });

      expect(response.status).toBe(200);
      expect(response.body.user.email).toBeNull();
      expect(await countUsers()).toBe(2);
    });

    it("never lets a Facebook login collide with an email account", async () => {
      await registerWithPassword("shared");

      const response = await oauthLogin("facebook", {
        credential: facebookCredential("shared"),
      });

      expect(response.status).toBe(200);
      expect(await countUsers()).toBe(2);
    });

    it("answers 401 INVALID_PROVIDER_CREDENTIAL when the provider rejects the credential", async () => {
      const response = await oauthLogin("google", { credential: "bad" });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_PROVIDER_CREDENTIAL");
      expect(await countUsers()).toBe(0);
    });

    it("answers 502 PROVIDER_UNAVAILABLE when the provider cannot be reached", async () => {
      const response = await oauthLogin("facebook", { credential: "down" });

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("answers 502 for a provider that is not configured", async () => {
      const unconfigured = createApp({
        pool,
        jwtSecret: SECRET,
        logger: pino({ level: "silent" }),
      });

      const response = await oauthLogin(
        "google",
        { credential: "anything" },
        unconfigured,
      );

      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("never logs the credential", async () => {
      await oauthLogin("google", { credential: "bad-secret-credential-123" });
      await oauthLogin("facebook", { credential: "down" });
      await loginWithGoogle("ada");

      expect(logLines.length).toBeGreaterThan(0);
      expect(logLines.join("")).not.toContain("bad-secret-credential-123");
      expect(logLines.join("")).not.toContain("google-token-ada");
    });

    it.each([
      ["an unknown provider", "twitter", { credential: "x" }],
      ["a missing credential", "google", {}],
      ["an empty credential", "google", { credential: "" }],
      ["a credential that is not a string", "google", { credential: 42 }],
      ["an oversized credential", "google", { credential: "x".repeat(5000) }],
      ["an extra field", "google", { credential: "x", admin: true }],
    ])("answers 400 for %s", async (_label, provider, body) => {
      const response = await oauthLogin(provider, body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("cuts a long provider name to 50 characters and replaces a blank one", async () => {
      const long = await oauthLogin("google", {
        credential: googleCredential("long", { displayName: "é".repeat(80) }),
      });
      const blank = await oauthLogin("google", {
        credential: googleCredential("blank", { displayName: "   " }),
      });

      expect(long.status).toBe(200);
      expect(Array.from(long.body.user.displayName)).toHaveLength(50);
      expect(blank.body.user.displayName).toBe("Music Room user");
    });

    it("cannot be used to log in to a social-only account with a password", async () => {
      const session = await loginWithGoogle("ada");

      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: session.user.email, password: PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    // One round only hits the race window now and then (a few milliseconds wide), so
    // run many rounds, each with a brand-new account: a bug here showed up as a
    // wrong EMAIL_TAKEN for the owner of the very account being created.
    it("lets exactly one account be created when the first logins arrive together", async () => {
      for (let round = 0; round < 20; round++) {
        const credential = googleCredential(`racer-${round}`);

        const responses = await Promise.all(
          Array.from({ length: 8 }, () => oauthLogin("google", { credential })),
        );

        expect(
          responses.map((r) => r.status),
          `round ${round}`,
        ).toEqual(Array(8).fill(200));
        expect(new Set(responses.map((r) => r.body.user.id)).size).toBe(1);
      }
      expect(await countUsers()).toBe(20);
    });

    // The winner is a transaction we hold open. The login under test reaches its
    // insert, blocks on the winner's uncommitted row, and fails once we commit:
    // the exact interleaving a real race produces, but on demand.
    it.each([
      ["email", { verifiedEmail: `racing${EMAIL_DOMAIN}` }],
      ["provider account", { verifiedEmail: null }],
    ])(
      "logs in as the winner when the unique %s index is lost to a concurrent signup",
      async (_label, extra) => {
        const credential = googleCredential("racing", extra);
        const identity = googleAccounts[credential]!;
        const winner = await pool.connect();
        let pending;
        try {
          await winner.query("BEGIN");
          const { rows } = await winner.query(
            "INSERT INTO users (email, display_name) VALUES ($1, 'Winner') RETURNING id",
            [identity.verifiedEmail],
          );
          await winner.query(
            "INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES ($1, 'google', $2)",
            [rows[0].id, identity.providerUserId],
          );
          pending = oauthLogin("google", { credential }).then((response) => response);
          await new Promise((resolve) => setTimeout(resolve, 300)); // let it block on the insert
          await winner.query("COMMIT");

          const response = await pending;
          expect(response.status).toBe(200);
          expect(response.body.user.id).toBe(rows[0].id);
          expect(await countUsers()).toBe(1);
        } finally {
          await winner.query("ROLLBACK").catch(() => undefined); // never hand a connection back inside an open transaction
          winner.release();
        }
      },
    );

    it("shares the login rate limit", async () => {
      const limited = buildApp({ loginLimit: { windowMs: 60_000, limit: 2 } });

      const statuses = [];
      for (let i = 0; i < 3; i++) {
        statuses.push(
          (await oauthLogin("google", { credential: "bad" }, limited)).status,
        );
      }

      expect(statuses).toEqual([401, 401, 429]);
    });
  });

  describe("POST /users/me/providers/{provider} (link)", () => {
    it("links Google to a password account, and that Google account then logs in as it", async () => {
      const session = await registerWithPassword("linker");

      const linked = await link(session.accessToken, "google", {
        credential: googleCredential("linker-g"),
      });

      expect(linked.status).toBe(200);
      expect(linked.body.linkedProviders).toEqual(["google"]);
      expect((await me(session.accessToken)).body.linkedProviders).toEqual(["google"]);
      const viaGoogle = await oauthLogin("google", {
        credential: googleCredential("linker-g"),
      });
      expect(viaGoogle.body.user.id).toBe(session.user.id);
    });

    it("lets a user link both providers", async () => {
      const session = await registerWithPassword("both");
      await link(session.accessToken, "google", {
        credential: googleCredential("both-g"),
      });

      const linked = await link(session.accessToken, "facebook", {
        credential: facebookCredential("both-f"),
      });

      expect(linked.body.linkedProviders).toEqual(["facebook", "google"]);
    });

    it("requires authentication", async () => {
      const response = await request(app)
        .post("/api/v1/users/me/providers/google")
        .send({ credential: googleCredential("anon") });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("refuses a provider account that already belongs to another user", async () => {
      const owner = await loginWithGoogle("owned");
      const other = await registerWithPassword("thief");

      const response = await link(other.accessToken, "google", {
        credential: googleCredential("owned"),
      });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("PROVIDER_ACCOUNT_LINKED");
      expect((await me(owner.accessToken)).body.linkedProviders).toEqual(["google"]);
      expect((await me(other.accessToken)).body.linkedProviders).toEqual([]);
    });

    it("refuses the same account twice and a second account of the same provider", async () => {
      const session = await registerWithPassword("twice");
      await link(session.accessToken, "google", {
        credential: googleCredential("twice-1"),
      });

      const again = await link(session.accessToken, "google", {
        credential: googleCredential("twice-1"),
      });
      const second = await link(session.accessToken, "google", {
        credential: googleCredential("twice-2"),
      });

      expect(again.body.error.code).toBe("PROVIDER_ACCOUNT_LINKED");
      expect(second.body.error.code).toBe("PROVIDER_ACCOUNT_LINKED");
    });

    it("lets only one of two users win a provider account claimed at the same time", async () => {
      const a = await registerWithPassword("claim-a");
      const b = await registerWithPassword("claim-b");
      const credential = googleCredential("contested");

      const [first, second] = await Promise.all([
        link(a.accessToken, "google", { credential }),
        link(b.accessToken, "google", { credential }),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
    });

    it("passes provider failures through", async () => {
      const session = await registerWithPassword("fails");

      const rejected = await link(session.accessToken, "google", { credential: "bad" });
      const down = await link(session.accessToken, "google", { credential: "down" });

      expect(rejected.body.error.code).toBe("INVALID_PROVIDER_CREDENTIAL");
      expect(down.status).toBe(502);
    });

    it("answers 401 when the token is valid but the user was deleted", async () => {
      const session = await registerWithPassword("ghost");
      await pool.query("DELETE FROM users WHERE id = $1", [session.user.id]);

      const response = await link(session.accessToken, "google", {
        credential: googleCredential("ghost-g"),
      });

      expect(response.status).toBe(401);
    });

    it("validates the provider and the body", async () => {
      const session = await registerWithPassword("valid");

      expect(
        (await link(session.accessToken, "twitter", { credential: "x" })).status,
      ).toBe(400);
      expect((await link(session.accessToken, "google", {})).status).toBe(400);
    });
  });

  describe("DELETE /users/me/providers/{provider} (unlink)", () => {
    it("unlinks a provider from an account that also has a password", async () => {
      const session = await registerWithPassword("keeper");
      await link(session.accessToken, "google", {
        credential: googleCredential("keeper-g"),
      });

      const response = await unlink(session.accessToken, "google");

      expect(response.status).toBe(200);
      expect(response.body.linkedProviders).toEqual([]);
      expect((await me(session.accessToken)).body.linkedProviders).toEqual([]);
    });

    it("answers 404 for a provider that is not linked", async () => {
      const session = await registerWithPassword("nolink");

      const response = await unlink(session.accessToken, "facebook");

      expect(response.status).toBe(404);
    });

    it("refuses to remove the only login method of a social-only account", async () => {
      const session = await loginWithGoogle("solo");

      const response = await unlink(session.accessToken, "google", viaGoogle("solo"));

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("LAST_LOGIN_METHOD");
      expect((await me(session.accessToken)).body.linkedProviders).toEqual(["google"]);
    });

    it("lets a social-only account drop one of two providers, then refuses the last", async () => {
      const session = await loginWithGoogle("duo");
      await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("duo-f") },
        viaGoogle("duo"),
      );

      const first = await unlink(session.accessToken, "google", viaGoogle("duo"));
      const last = await unlink(session.accessToken, "facebook", viaFacebook("duo-f"));

      expect(first.status).toBe(200);
      expect(first.body.linkedProviders).toEqual(["facebook"]);
      expect(last.body.error.code).toBe("LAST_LOGIN_METHOD");
    });

    it("never ends with zero login methods when both unlinks arrive together", async () => {
      const session = await loginWithGoogle("race");
      await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("race-f") },
        viaGoogle("race"),
      );

      const [dropGoogle, dropFacebook] = await Promise.all([
        unlink(session.accessToken, "google", viaGoogle("race")),
        unlink(session.accessToken, "facebook", viaFacebook("race-f")),
      ]);

      expect([dropGoogle.status, dropFacebook.status].sort()).toEqual([200, 409]);
      const remaining = await pool.query(
        "SELECT count(*) FROM oauth_identities WHERE user_id = $1",
        [session.user.id],
      );
      expect(Number(remaining.rows[0].count)).toBe(1);
    });

    it("requires authentication and a known provider", async () => {
      const anonymous = await request(app).delete("/api/v1/users/me/providers/google");
      const session = await registerWithPassword("unlinkvalid");
      const unknown = await unlink(session.accessToken, "twitter");

      expect(anonymous.status).toBe(401);
      expect(unknown.status).toBe(400);
    });

    it("frees the provider account so someone else can link it afterwards", async () => {
      const first = await registerWithPassword("freeing");
      await link(first.accessToken, "google", { credential: googleCredential("freed") });
      await unlink(first.accessToken, "google");
      const second = await registerWithPassword("taking");

      const response = await link(second.accessToken, "google", {
        credential: googleCredential("freed"),
      });

      expect(response.status).toBe(200);
    });
  });
  describe("proof of ownership for link and unlink (ADR-025)", () => {
    const providersOf = async (userId: string) =>
      (
        await pool.query(
          "SELECT provider FROM oauth_identities WHERE user_id = $1 ORDER BY provider",
          [userId],
        )
      ).rows.map((row) => row.provider);

    it("refuses to link without any proof, and links nothing", async () => {
      const victim = await registerWithPassword("noproof");

      const response = await link(
        victim.accessToken,
        "google",
        { credential: googleCredential("noproof-attacker") },
        null,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(await providersOf(victim.user.id)).toEqual([]);
    });

    it("a stolen access token cannot link the thief's social account, and the thief cannot then log in as the victim", async () => {
      const victim = await registerWithPassword("victim");
      const thiefCredential = googleCredential("thief-google");

      const guesses = [
        { method: "password", password: "not-the-password" },
        { method: "provider", provider: "google", credential: thiefCredential },
        { method: "provider", provider: "facebook", credential: "bad" },
      ];
      for (const guess of guesses) {
        const response = await link(
          victim.accessToken,
          "google",
          { credential: thiefCredential },
          guess,
        );
        expect(response.status, JSON.stringify(guess)).toBe(403);
        expect(response.body.error.code).toBe("REAUTH_FAILED");
      }

      expect(await providersOf(victim.user.id)).toEqual([]);
      const thiefLogin = await oauthLogin("google", { credential: thiefCredential });
      expect(thiefLogin.body.user.id).not.toBe(victim.user.id);
    });

    it("refuses a wrong password, and a password proof from an account that has none", async () => {
      const passwordAccount = await registerWithPassword("wrongpw");
      const socialOnly = await loginWithGoogle("nopw");

      const wrong = await link(
        passwordAccount.accessToken,
        "google",
        { credential: googleCredential("wrongpw-g") },
        { method: "password", password: PASSWORD + "x" },
      );
      const noPassword = await link(
        socialOnly.accessToken,
        "facebook",
        { credential: facebookCredential("nopw-f") },
        withPassword,
      );

      expect(wrong.body.error.code).toBe("REAUTH_FAILED");
      expect(noPassword.status).toBe(403);
      expect(noPassword.body.error.code).toBe("REAUTH_FAILED");
      expect(await providersOf(socialOnly.user.id)).toEqual(["google"]);
    });

    it("lets a social-only account link another provider by proving itself with the one it has", async () => {
      const session = await loginWithGoogle("prover");

      const response = await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("prover-f") },
        viaGoogle("prover"),
      );

      expect(response.status).toBe(200);
      expect(response.body.linkedProviders).toEqual(["facebook", "google"]);
    });

    it("refuses a provider proof that is valid but belongs to someone else or to no linked account", async () => {
      const mine = await loginWithGoogle("mine");
      await loginWithGoogle("theirs");

      const someoneElses = await link(
        mine.accessToken,
        "facebook",
        { credential: facebookCredential("mine-f") },
        viaGoogle("theirs"),
      );
      const unlinked = await link(
        mine.accessToken,
        "facebook",
        { credential: facebookCredential("mine-f") },
        viaGoogle("never-registered"),
      );

      expect(someoneElses.body.error.code).toBe("REAUTH_FAILED");
      expect(unlinked.body.error.code).toBe("REAUTH_FAILED");
      expect(await providersOf(mine.user.id)).toEqual(["google"]);
    });

    it("answers a failed provider proof with 403, never 401, so the app does not start a token refresh", async () => {
      const session = await registerWithPassword("not401");

      const bad = await link(
        session.accessToken,
        "google",
        { credential: googleCredential("not401-g") },
        { method: "provider", provider: "google", credential: "bad" },
      );

      expect(bad.status).toBe(403);
      expect(bad.body.error.code).toBe("REAUTH_FAILED");
    });

    it("passes a provider outage during the proof through as 502", async () => {
      const session = await loginWithGoogle("outage");

      const response = await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("outage-f") },
        { method: "provider", provider: "google", credential: "down" },
      );

      expect(response.status).toBe(502);
    });

    it("rejects malformed proofs", async () => {
      const session = await registerWithPassword("malformed");
      const credential = googleCredential("malformed-g");
      const bodies = [
        { method: "password" },
        { method: "password", password: "" },
        { method: "password", password: PASSWORD, extra: true },
        { method: "provider", provider: "twitter", credential: "x" },
        { method: "provider", provider: "google" },
        { method: "email", code: "123456" },
        {},
        "password",
      ];
      for (const reauth of bodies) {
        const response = await link(
          session.accessToken,
          "google",
          { credential },
          reauth as object,
        );
        expect(response.status, JSON.stringify(reauth)).toBe(400);
      }
    });

    it("unlinking also needs proof: a wrong or missing one removes nothing", async () => {
      const session = await registerWithPassword("unlinkproof");
      await link(session.accessToken, "google", {
        credential: googleCredential("unlinkproof-g"),
      });

      const wrong = await unlink(session.accessToken, "google", {
        method: "password",
        password: "nope",
      });
      const missing = await unlink(session.accessToken, "google", null);
      const noBody = await request(app)
        .delete("/api/v1/users/me/providers/google")
        .set("Authorization", `Bearer ${session.accessToken}`);

      expect(wrong.status).toBe(403);
      expect(wrong.body.error.code).toBe("REAUTH_FAILED");
      expect(missing.status).toBe(400);
      expect(noBody.status).toBe(400);
      expect(await providersOf(session.user.id)).toEqual(["google"]);
    });

    it("unlinking works with a provider proof, including the provider being removed", async () => {
      const session = await loginWithGoogle("selfproof");
      await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("selfproof-f") },
        viaGoogle("selfproof"),
      );

      const response = await unlink(
        session.accessToken,
        "google",
        viaGoogle("selfproof"),
      );

      expect(response.status).toBe(200);
      expect(response.body.linkedProviders).toEqual(["facebook"]);
    });

    it("checks the proof before reporting that a provider is not linked", async () => {
      const session = await registerWithPassword("order");

      const wrong = await unlink(session.accessToken, "facebook", {
        method: "password",
        password: "nope",
      });

      expect(wrong.status).toBe(403);
    });

    it("limits wrong proofs per address on both link and unlink, so neither is a way to guess a password", async () => {
      const limited = buildApp({ loginLimit: { windowMs: 60_000, limit: 3 } });
      const session = await registerWithPassword("guessing");
      const wrong = { method: "password", password: "nope" };

      const statuses = [
        (await unlink(session.accessToken, "google", wrong, limited)).status,
        (await link(session.accessToken, "google", { credential: "x" }, wrong, limited))
          .status,
        (await unlink(session.accessToken, "google", wrong, limited)).status,
        (await unlink(session.accessToken, "google", wrong, limited)).status,
        (await link(session.accessToken, "google", { credential: "x" }, wrong, limited))
          .status,
      ];

      expect(statuses).toEqual([403, 403, 403, 429, 429]);
    });

    it("never writes the password or the provider credential to the logs", async () => {
      const session = await registerWithPassword("logs");
      const secretCredential = googleCredential("logs-secret-credential");
      await link(
        session.accessToken,
        "google",
        { credential: googleCredential("logs-g") },
        { method: "password", password: "wrong-password-in-body" },
      );
      await link(
        session.accessToken,
        "facebook",
        { credential: facebookCredential("logs-f") },
        { method: "provider", provider: "google", credential: secretCredential },
      );

      const logs = logLines.join("");
      expect(logs).toContain("re-authentication failed");
      expect(logs).not.toContain("wrong-password-in-body");
      expect(logs).not.toContain(secretCredential);
    });
  });
});
