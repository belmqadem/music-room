import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createGoogleVerifier } from "../../src/modules/auth/google-verifier.js";
import {
  ProviderCredentialError,
  ProviderUnavailableError,
} from "../../src/modules/auth/provider-verifier.js";

const CLIENT_ID = "ios-client.apps.googleusercontent.com";
const OTHER_CLIENT_ID = "android-client.apps.googleusercontent.com";

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  getKey = createLocalJWKSet({ keys: [jwk] });
});

interface TokenOptions {
  key?: CryptoKey;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  claims?: Record<string, unknown>;
  subject?: string | null;
}

async function idToken(options: TokenOptions = {}): Promise<string> {
  const jwt = new SignJWT({
    email: "ada@example.com",
    email_verified: true,
    name: "Ada Lovelace",
    ...options.claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 600);
  if (options.subject !== null) jwt.setSubject(options.subject ?? "google-user-1");
  return jwt.sign(options.key ?? privateKey);
}

const verifier = () =>
  createGoogleVerifier({ clientIds: [CLIENT_ID, OTHER_CLIENT_ID], getKey });

describe("Google ID token verifier", () => {
  it("returns the identity of a valid token", async () => {
    expect(await verifier().verify(await idToken())).toEqual({
      providerUserId: "google-user-1",
      displayName: "Ada Lovelace",
      verifiedEmail: "ada@example.com",
    });
  });

  it("accepts any of our client ids and both issuer spellings", async () => {
    const token = await idToken({
      audience: OTHER_CLIENT_ID,
      issuer: "accounts.google.com",
    });
    expect((await verifier().verify(token)).providerUserId).toBe("google-user-1");
  });

  it("drops an email that Google does not mark as verified", async () => {
    const token = await idToken({ claims: { email_verified: false } });
    expect((await verifier().verify(token)).verifiedEmail).toBeNull();
  });

  it("accepts the legacy string form email_verified: 'true'", async () => {
    const token = await idToken({ claims: { email_verified: "true" } });
    expect((await verifier().verify(token)).verifiedEmail).toBe("ada@example.com");
  });

  it("has no email when the token carries none", async () => {
    const token = await idToken({
      claims: { email: undefined, email_verified: undefined },
    });
    expect((await verifier().verify(token)).verifiedEmail).toBeNull();
  });

  it.each([
    ["a token issued to another app", { audience: "someone-elses-app" }],
    ["a token from another issuer", { issuer: "https://evil.example" }],
    ["an expired token", { expiresAt: Math.floor(Date.now() / 1000) - 3600 }],
    ["a token without a subject", { subject: null }],
  ] satisfies [string, TokenOptions][])("rejects %s", async (_label, options) => {
    await expect(verifier().verify(await idToken(options))).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects a token signed with a key Google does not publish", async () => {
    const token = await idToken({ key: otherPrivateKey });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects a token claiming HS256 (algorithm confusion)", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setSubject("google-user-1")
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode("x".repeat(32)));
    await expect(verifier().verify(forged)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it("rejects an unsigned token ('none')", async () => {
    const header = Buffer.from('{"alg":"none"}').toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ sub: "x", iss: "accounts.google.com", aud: CLIENT_ID }),
    ).toString("base64url");
    await expect(verifier().verify(`${header}.${body}.`)).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it.each(["", "not-a-jwt", "a.b.c"])(
    "rejects the garbage credential %j",
    async (value) => {
      await expect(verifier().verify(value)).rejects.toBeInstanceOf(
        ProviderCredentialError,
      );
    },
  );

  it("reports the provider as unavailable when Google's keys cannot be fetched", async () => {
    const broken = createGoogleVerifier({
      clientIds: [CLIENT_ID],
      getKey: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(broken.verify(await idToken())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});
