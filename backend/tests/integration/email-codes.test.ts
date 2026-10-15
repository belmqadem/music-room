import type { Express } from "express";
import pg from "pg";
import pino from "pino";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { EMAIL_CODE_MAX_ATTEMPTS } from "../../src/modules/auth/email-code.js";
import { createMemoryMailer } from "../helpers/memory-mailer.js";
import { signUpVerified } from "../helpers/sign-up.js";

// Email verification and password reset (ADR-022) against a real Postgres (TEST_DATABASE_URL).
// Emails go to an in-memory mailer, from which the tests read the 6-digit code like a user would.
const databaseUrl = process.env.TEST_DATABASE_URL;
const SECRET = "s".repeat(32);
const EMAIL_DOMAIN = "@email-codes.invalid";
const PASSWORD = "Correct-Horse-Battery-9";
const NEW_PASSWORD = "Brand-New-Pass-42!";

describe.skipIf(!databaseUrl)("email verification and password reset", () => {
  let pool: pg.Pool;
  let app: Express;
  let mailer: ReturnType<typeof createMemoryMailer>;

  beforeAll(() => {
    pool = createPostgresPool(databaseUrl!);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${EMAIL_DOMAIN}`]);
  });
  afterAll(async () => {
    await pool.end();
  });

  // A fresh app and mailer per test so a test only sees its own emails.
  function buildApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}): Express {
    mailer = createMemoryMailer();
    return createApp({
      pool,
      jwtSecret: SECRET,
      logger: pino({ level: "silent" }),
      passwordCost: 4,
      mailer,
      loginLimit: { windowMs: 60_000, limit: 10_000 },
      registerLimit: { windowMs: 60_000, limit: 10_000 },
      refreshLimit: { windowMs: 60_000, limit: 10_000 },
      emailCodeLimit: { windowMs: 60_000, limit: 10_000 },
      ...overrides,
    });
  }
  const useFreshApp = () => {
    app = buildApp();
  };

  const email = (name: string) => `${name}${EMAIL_DOMAIN}`;
  const post = (path: string, body: object, target: Express = app) =>
    request(target).post(`/api/v1${path}`).send(body);
  const register = (name = "bob") =>
    post("/auth/register", { email: email(name), password: PASSWORD, displayName: name });
  const verify = (name: string, code: string) =>
    post("/auth/verify-email", { email: email(name), code });
  const login = (name: string, password = PASSWORD) =>
    post("/auth/login", { email: email(name), password });
  const forgot = (name: string) => post("/auth/forgot-password", { email: email(name) });
  const reset = (name: string, code: string, newPassword = NEW_PASSWORD) =>
    post("/auth/reset-password", { email: email(name), code, newPassword });
  const resend = (name: string) =>
    post("/auth/resend-verification", { email: email(name) });
  const lastCode = (name: string) => mailer.lastCodeFor(email(name));
  // The wrong code that is guaranteed not to be the right one.
  const wrongCodeFor = (name: string) =>
    lastCode(name) === "000000" ? "000001" : "000000";

  /** Makes the pending code look as old as `ms`, so the resend cooldown / expiry can be tested. */
  async function ageCode(name: string, purpose: string, ms: number) {
    await pool.query(
      `UPDATE email_codes SET created_at = created_at - ($3 * interval '1 millisecond'),
                              expires_at = expires_at - ($3 * interval '1 millisecond')
       WHERE purpose = $2 AND user_id = (SELECT id FROM users WHERE email = $1)`,
      [email(name), purpose, ms],
    );
  }
  async function attemptsOf(name: string, purpose: string) {
    const { rows } = await pool.query(
      `SELECT attempts FROM email_codes WHERE purpose = $2
         AND user_id = (SELECT id FROM users WHERE email = $1)`,
      [email(name), purpose],
    );
    return rows[0]?.attempts as number | undefined;
  }

  describe("verifying the email after register", () => {
    it("refuses to log in until the email is confirmed, but only for the right password", async () => {
      useFreshApp();
      await register();

      const right = await login("bob");
      const wrong = await login("bob", "Wrong-Password-1!");
      const unknown = await login("nobody");

      expect(right.status).toBe(403);
      expect(right.body.error.code).toBe("EMAIL_NOT_VERIFIED");
      // A wrong password or unknown address looks exactly the same as before: no hint.
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("emails a 6-digit code that does not appear in the response or the database", async () => {
      useFreshApp();
      const response = await register();

      const code = lastCode("bob");
      expect(code).toMatch(/^\d{6}$/);
      expect(JSON.stringify(response.body)).not.toContain(code);
      expect(mailer.sent).toHaveLength(1);
      const { rows } = await pool.query("SELECT code_hash FROM email_codes");
      expect(rows.some((row) => JSON.stringify(row).includes(code))).toBe(false);
    });

    it("confirms the email with the right code (204) and then lets the user log in", async () => {
      useFreshApp();
      await register();

      const response = await verify("bob", lastCode("bob"));
      const session = await login("bob");

      expect(response.status).toBe(204);
      expect(session.status).toBe(200);
      expect(session.body.user.emailVerified).toBe(true);
    });

    it("spends the code: a second use is refused", async () => {
      useFreshApp();
      await register();
      const code = lastCode("bob");
      await verify("bob", code);

      const again = await verify("bob", code);

      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe("INVALID_CODE");
    });

    it("lets exactly one of 8 simultaneous submissions of the right code win", async () => {
      useFreshApp();
      await register();
      const code = lastCode("bob");

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => verify("bob", code)),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([
        204, 400, 400, 400, 400, 400, 400, 400,
      ]);
    });

    it("answers a wrong code, an unknown address and an expired code with the identical body", async () => {
      useFreshApp();
      await register();
      const wrong = await verify("bob", wrongCodeFor("bob"));
      const unknown = await verify("nobody", "123456");
      await ageCode("bob", "verify_email", 11 * 60_000);
      const expired = await verify("bob", lastCode("bob"));

      for (const response of [wrong, unknown, expired]) {
        expect(response.status).toBe(400);
        expect(response.body).toEqual(wrong.body);
      }
      expect(wrong.body.error.code).toBe("INVALID_CODE");
    });

    it(`kills the code after ${EMAIL_CODE_MAX_ATTEMPTS} wrong tries, even for the right code`, async () => {
      useFreshApp();
      await register();
      const code = lastCode("bob");
      const wrong = wrongCodeFor("bob");
      for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) await verify("bob", wrong);

      const rightButLate = await verify("bob", code);

      expect(rightButLate.status).toBe(400);
      expect((await login("bob")).status).toBe(403);
    });

    it("never lets simultaneous guesses exceed the tries limit", async () => {
      useFreshApp();
      await register();
      const wrong = wrongCodeFor("bob");

      await Promise.all(Array.from({ length: 20 }, () => verify("bob", wrong)));

      expect(await attemptsOf("bob", "verify_email")).toBe(EMAIL_CODE_MAX_ATTEMPTS);
    });

    it("does not accept a password-reset code as a verification code", async () => {
      useFreshApp();
      await register();
      await forgot("bob");
      const resetCode = lastCode("bob");
      // Remove the verification code so only the reset code exists for this user.
      await pool.query("DELETE FROM email_codes WHERE purpose = 'verify_email'");

      const response = await verify("bob", resetCode);

      expect(response.status).toBe(400);
    });

    it("does not accept another user's code", async () => {
      useFreshApp();
      await register("bob");
      await register("eve");
      const bobsCode = lastCode("bob");

      const response = await verify("eve", bobsCode);

      expect(response.status).toBe(400);
    });

    it.each([
      ["a code that is not 6 digits", { email: "a@email-codes.invalid", code: "12345" }],
      ["a code with letters", { email: "a@email-codes.invalid", code: "12345a" }],
      ["no code", { email: "a@email-codes.invalid" }],
      ["an invalid email", { email: "nope", code: "123456" }],
      ["an unknown field", { email: "a@email-codes.invalid", code: "123456", admin: 1 }],
    ])("answers 400 VALIDATION_ERROR for %s", async (_label, body) => {
      useFreshApp();

      const response = await post("/auth/verify-email", body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("sending the verification code again", () => {
    it("replaces the old code with a new one", async () => {
      useFreshApp();
      await register();
      const oldCode = lastCode("bob");
      await ageCode("bob", "verify_email", 61_000); // past the resend cooldown

      const response = await resend("bob");

      expect(response.status).toBe(204);
      expect(mailer.sent).toHaveLength(2);
      const newCode = lastCode("bob");
      if (newCode !== oldCode) expect((await verify("bob", oldCode)).status).toBe(400);
      expect((await verify("bob", newCode)).status).toBe(204);
    });

    it("sends nothing inside the one-minute cooldown, and says the same", async () => {
      useFreshApp();
      await register();

      const response = await resend("bob");

      expect(response.status).toBe(204);
      expect(mailer.sent).toHaveLength(1);
    });

    it("answers the same and sends nothing for an unknown address, a verified one and a social one", async () => {
      useFreshApp();
      await signUpVerified(app, mailer, {
        email: email("done"),
        password: PASSWORD,
        displayName: "Done",
      });
      await pool.query(
        "INSERT INTO users (email, display_name, email_verified_at) VALUES ($1, 'Social', now())",
        [email("social")],
      );
      const before = mailer.sent.length;

      const responses = await Promise.all([
        resend("nobody"),
        resend("done"),
        resend("social"),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(204);
        expect(response.body).toEqual({});
      }
      expect(mailer.sent).toHaveLength(before);
    });

    it("does not let a mail server failure break register: the account exists and can ask again", async () => {
      app = buildApp({ mailer: { send: () => Promise.reject(new Error("smtp down")) } });

      const response = await register("bob");

      expect(response.status).toBe(201);
      const { rowCount } = await pool.query("SELECT 1 FROM users WHERE email = $1", [
        email("bob"),
      ]);
      expect(rowCount).toBe(1);
    });
  });

  describe("forgot and reset password", () => {
    async function verifiedBob() {
      useFreshApp();
      return signUpVerified(app, mailer, {
        email: email("bob"),
        password: PASSWORD,
        displayName: "Bob",
      });
    }

    it("answers the same for a known and an unknown address, and only emails the known one", async () => {
      await verifiedBob();
      const before = mailer.sent.length;

      const known = await forgot("bob");
      const unknown = await forgot("nobody");

      expect(known.status).toBe(204);
      expect(unknown.status).toBe(204);
      expect(known.body).toEqual(unknown.body);
      expect(mailer.sent).toHaveLength(before + 1);
      expect(mailer.sent.at(-1)?.to).toBe(email("bob"));
    });

    it("sends nothing to a social-only account: it has no password to reset", async () => {
      useFreshApp();
      await pool.query(
        "INSERT INTO users (email, display_name, email_verified_at) VALUES ($1, 'Social', now())",
        [email("social")],
      );

      const response = await forgot("social");

      expect(response.status).toBe(204);
      expect(mailer.sent).toHaveLength(0);
    });

    it("sets the new password: the old one stops working, the new one works", async () => {
      await verifiedBob();
      await forgot("bob");

      const response = await reset("bob", lastCode("bob"));

      expect(response.status).toBe(204);
      expect((await login("bob", PASSWORD)).status).toBe(401);
      expect((await login("bob", NEW_PASSWORD)).status).toBe(200);
    });

    it("spends the code: a second reset with it is refused", async () => {
      await verifiedBob();
      await forgot("bob");
      const code = lastCode("bob");
      await reset("bob", code);

      const again = await reset("bob", code, "Another-New-Pass-7!");

      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe("INVALID_CODE");
      expect((await login("bob", NEW_PASSWORD)).status).toBe(200);
    });

    it("enforces the password policy WITHOUT spending the code", async () => {
      await verifiedBob();
      await forgot("bob");
      const code = lastCode("bob");

      const weak = await reset("bob", code, "weakpassword");
      const strong = await reset("bob", code);

      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe("VALIDATION_ERROR");
      expect(strong.status).toBe(204);
    });

    it("logs the user out everywhere: every refresh token stops working", async () => {
      const session = await verifiedBob();
      await forgot("bob");

      await reset("bob", lastCode("bob"));
      const refreshed = await post("/auth/refresh", {
        refreshToken: session.body.refreshToken,
      });

      expect(refreshed.status).toBe(401);
      expect(refreshed.body.error.code).toBe("INVALID_REFRESH_TOKEN");
    });

    it("refuses a wrong code and kills the code after too many tries", async () => {
      await verifiedBob();
      await forgot("bob");
      const code = lastCode("bob");
      const wrong = wrongCodeFor("bob");
      for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) {
        expect((await reset("bob", wrong)).status).toBe(400);
      }

      const rightButLate = await reset("bob", code);

      expect(rightButLate.status).toBe(400);
      expect((await login("bob", PASSWORD)).status).toBe(200); // password unchanged
    });

    it("does not accept a verification code as a reset code", async () => {
      useFreshApp();
      await register();
      const verificationCode = lastCode("bob");

      const response = await reset("bob", verificationCode);

      expect(response.status).toBe(400);
      expect((await login("bob", PASSWORD)).status).toBe(403); // password unchanged, still unverified
    });

    it("lets the real owner take back an address someone registered first: the reset also proves the email", async () => {
      useFreshApp();
      await register("bob"); // the squatter, who never proves the mailbox
      await forgot("bob"); // the owner, who does receive the mail

      const resetResponse = await reset("bob", lastCode("bob"));
      const session = await login("bob", NEW_PASSWORD);

      expect(resetResponse.status).toBe(204);
      expect(session.status).toBe(200);
      expect(session.body.user.emailVerified).toBe(true);
      expect((await login("bob", PASSWORD)).status).toBe(401); // the squatter's password is gone
    });

    it("rejects a reset with an unknown address exactly like a wrong code", async () => {
      useFreshApp();
      const unknown = await reset("nobody", "123456");
      await register();
      const wrong = await reset("bob", wrongCodeFor("bob"));

      expect(unknown.status).toBe(400);
      expect(unknown.body).toEqual(wrong.body);
    });
  });

  describe("rate limiting", () => {
    it("limits the four code endpoints with one shared counter per IP", async () => {
      const limited = buildApp({ emailCodeLimit: { windowMs: 60_000, limit: 3 } });
      const send = (path: string) =>
        post(
          path,
          { email: email("bob"), code: "123456", newPassword: NEW_PASSWORD },
          limited,
        );

      const statuses = [
        (await send("/auth/verify-email")).status,
        (await send("/auth/forgot-password")).status,
        (await send("/auth/resend-verification")).status,
        (await send("/auth/reset-password")).status,
      ];

      expect(statuses.slice(0, 3)).not.toContain(429);
      expect(statuses[3]).toBe(429);
    });
  });
});
