import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createFacebookVerifier } from "../../src/modules/auth/facebook-verifier.js";
import {
  ProviderCredentialError,
  ProviderUnavailableError,
} from "../../src/modules/auth/provider-verifier.js";

const APP_ID = "1234567890";
const APP_SECRET = "very-secret-app-secret";
const USER_TOKEN = "EAAB-user-token";

type Handler = (url: URL) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fake Graph API: routes by path and records every URL that was requested. */
function fakeGraph(handlers: { debug?: Handler; me?: Handler }) {
  const requested: URL[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url);
    const handler = url.pathname === "/debug_token" ? handlers.debug : handlers.me;
    if (!handler) throw new Error(`unexpected request to ${url.pathname}`);
    return handler(url);
  }) as typeof fetch;
  return { fakeFetch, requested };
}

const okDebug: Handler = () =>
  json({ data: { is_valid: true, app_id: APP_ID, user_id: "fb-user-1" } });
const okMe: Handler = () => json({ id: "fb-user-1", name: "Grace Hopper" });

const verifierFor = (fakeFetch: typeof fetch) =>
  createFacebookVerifier({ appId: APP_ID, appSecret: APP_SECRET, fetch: fakeFetch });

describe("Facebook access token verifier", () => {
  it("returns the identity of a valid token, with no email", async () => {
    const { fakeFetch } = fakeGraph({ debug: okDebug, me: okMe });

    expect(await verifierFor(fakeFetch).verify(USER_TOKEN)).toEqual({
      providerUserId: "fb-user-1",
      displayName: "Grace Hopper",
      verifiedEmail: null,
    });
  });

  it("inspects the token with OUR app token and reads /me with the user's token", async () => {
    const { fakeFetch, requested } = fakeGraph({ debug: okDebug, me: okMe });
    await verifierFor(fakeFetch).verify(USER_TOKEN);

    const debug = requested.find((url) => url.pathname === "/debug_token");
    expect(debug?.searchParams.get("input_token")).toBe(USER_TOKEN);
    expect(debug?.searchParams.get("access_token")).toBe(`${APP_ID}|${APP_SECRET}`);
    const me = requested.find((url) => url.pathname === "/me");
    expect(me?.searchParams.get("access_token")).toBe(USER_TOKEN);
    expect(me?.searchParams.get("fields")).toBe("id,name");
  });

  it.each([
    [
      "Facebook says the token is not valid",
      { is_valid: false, app_id: APP_ID, user_id: "fb-user-1" },
    ],
    [
      "the token was issued to another app",
      { is_valid: true, app_id: "999", user_id: "fb-user-1" },
    ],
    ["there is no user id", { is_valid: true, app_id: APP_ID }],
  ])("rejects when %s", async (_label, data) => {
    const { fakeFetch } = fakeGraph({ debug: () => json({ data }), me: okMe });

    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects an answer without data", async () => {
    const { fakeFetch } = fakeGraph({ debug: () => json({}), me: okMe });
    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects when Facebook answers 400 (the usual way to refuse a token)", async () => {
    const { fakeFetch } = fakeGraph({
      debug: () => json({ error: { code: 190 } }, 400),
      me: okMe,
    });
    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects when /me describes a different person than debug_token", async () => {
    const { fakeFetch } = fakeGraph({
      debug: okDebug,
      me: () => json({ id: "someone-else", name: "Mallory" }),
    });
    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("uses a null display name when /me gives none", async () => {
    const { fakeFetch } = fakeGraph({
      debug: okDebug,
      me: () => json({ id: "fb-user-1" }),
    });
    expect((await verifierFor(fakeFetch).verify(USER_TOKEN)).displayName).toBeNull();
  });

  it.each([500, 502, 401, 403])(
    "reports the provider as unavailable on HTTP %i",
    async (status) => {
      const { fakeFetch } = fakeGraph({ debug: () => json({}, status), me: okMe });
      await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
        ProviderUnavailableError,
      );
    },
  );

  it("reports the provider as unavailable when /me fails", async () => {
    const { fakeFetch } = fakeGraph({ debug: okDebug, me: () => json({}, 503) });
    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("reports the provider as unavailable on a network failure or unreadable body", async () => {
    const down = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    await expect(verifierFor(down).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );

    const { fakeFetch } = fakeGraph({
      debug: () => new Response("<html>oops</html>", { status: 200 }),
    });
    await expect(verifierFor(fakeFetch).verify(USER_TOKEN)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("never puts the token or the app secret in an error message", async () => {
    const down = (() =>
      Promise.reject(new TypeError(`fetch failed ${USER_TOKEN}`))) as typeof fetch;
    const error = await verifierFor(down)
      .verify(USER_TOKEN)
      .catch((caught: Error) => caught);

    expect(String((error as Error).message)).not.toContain(USER_TOKEN);
    expect(String((error as Error).message)).not.toContain(APP_SECRET);
  });
});

// ---- Limited Login (ADR-032): an OpenID JWT signed by Facebook, checked locally ----

let facebookKey: CryptoKey;
let strangerKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  facebookKey = pair.privateKey;
  strangerKey = (await generateKeyPair("RS256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "fb1", alg: "RS256" };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

interface LimitedTokenOptions {
  key?: CryptoKey;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  subject?: string | null;
  claims?: Record<string, unknown>;
}

async function limitedToken(options: LimitedTokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({
    name: "Grace Hopper",
    email: "grace@example.com",
    ...options.claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "fb1" })
    .setIssuer(options.issuer ?? "https://www.facebook.com")
    .setAudience(options.audience ?? APP_ID)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 600);
  if (options.subject !== null) jwt.setSubject(options.subject ?? "fb-user-1");
  return jwt.sign(options.key ?? facebookKey);
}

/** The Graph API must never be asked about a Limited Login token. */
function limitedVerifier() {
  const { fakeFetch, requested } = fakeGraph({});
  const verifier = createFacebookVerifier({
    appId: APP_ID,
    appSecret: APP_SECRET,
    fetch: fakeFetch,
    getKey,
  });
  return { verifier, requested };
}

describe("Facebook Limited Login token verifier", () => {
  it("returns the identity of a valid token, locally, without asking the Graph API", async () => {
    const { verifier, requested } = limitedVerifier();

    const identity = await verifier.verify(await limitedToken());

    expect(identity).toEqual({
      providerUserId: "fb-user-1",
      displayName: "Grace Hopper",
      verifiedEmail: null,
    });
    expect(requested).toHaveLength(0);
  });

  it("ignores the email in the token, like the classic login (ADR-011)", async () => {
    const { verifier } = limitedVerifier();

    const identity = await verifier.verify(
      await limitedToken({ claims: { email: "grace@example.com" } }),
    );

    expect(identity.verifiedEmail).toBeNull();
  });

  it("uses a null display name when the token has none", async () => {
    const { verifier } = limitedVerifier();

    const identity = await verifier.verify(
      await limitedToken({ claims: { name: undefined } }),
    );

    expect(identity.displayName).toBeNull();
  });

  it.each([
    ["issued to another Facebook app", { audience: "9999999999" }],
    ["from another issuer", { issuer: "https://evil.example" }],
    [
      "signed with a key that is not Facebook's",
      { key: undefined as unknown as CryptoKey, useStranger: true },
    ],
    ["expired", { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ["without a subject", { subject: null }],
    ["with an empty subject", { subject: "" }],
  ])("rejects a token %s", async (_label, options) => {
    const { verifier } = limitedVerifier();
    const { useStranger, ...rest } = options as LimitedTokenOptions & {
      useStranger?: boolean;
    };
    const token = await limitedToken(useStranger ? { ...rest, key: strangerKey } : rest);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it("rejects an unsigned token (alg none) and a token claiming HS256", async () => {
    const { verifier } = limitedVerifier();
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const body = encode({
      iss: "https://www.facebook.com",
      aud: APP_ID,
      sub: "fb-user-1",
      iat: now,
      exp: now + 600,
    });
    const unsigned = `${encode({ alg: "none" })}.${body}.x`;
    const hs256 = `${encode({ alg: "HS256", kid: "fb1" })}.${body}.c2lnbmF0dXJl`;

    await expect(verifier.verify(unsigned)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
    await expect(verifier.verify(hs256)).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it("reports the provider as unavailable when Facebook's keys cannot be fetched", async () => {
    const { fakeFetch } = fakeGraph({});
    const verifier = createFacebookVerifier({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetch: fakeFetch,
      getKey: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(verifier.verify(await limitedToken())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it("still sends a classic access token (no dots) to the Graph API", async () => {
    const { fakeFetch, requested } = fakeGraph({ debug: okDebug, me: okMe });
    const verifier = createFacebookVerifier({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetch: fakeFetch,
      getKey,
    });

    await verifier.verify(USER_TOKEN);

    expect(requested.map((url) => url.pathname)).toEqual(["/debug_token", "/me"]);
  });
});
