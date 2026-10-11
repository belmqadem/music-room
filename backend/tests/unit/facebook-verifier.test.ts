import { describe, expect, it } from "vitest";
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
