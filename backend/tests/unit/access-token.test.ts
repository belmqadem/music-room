import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenError,
  signAccessToken,
  verifyAccessToken,
} from "../../src/modules/auth/access-token.js";

const SECRET = "s".repeat(32);
const OTHER_SECRET = "o".repeat(32);
const USER_ID = "3f2b8c1e-5d7a-4c1b-9a3e-2b1f6d8e7c90";
const key = (secret: string) => new TextEncoder().encode(secret);

function decodePayload(token: string): {
  exp: number;
  iat: number;
  sub: string;
  iss: string;
} {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

async function expectRejected(promise: Promise<unknown>, reason: "expired" | "invalid") {
  await expect(promise).rejects.toBeInstanceOf(AccessTokenError);
  await expect(promise).rejects.toMatchObject({ reason });
}

describe("access token", () => {
  it("expires 15 minutes after it is issued", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: true });
    const { exp, iat } = decodePayload(token);

    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(exp - iat).toBe(900);
  });

  it("round-trips the user id and whether the display name is set (ADR-046)", async () => {
    for (const displayNameSet of [true, false]) {
      const token = await signAccessToken(USER_ID, SECRET, { displayNameSet });
      await expect(verifyAccessToken(token, SECRET)).resolves.toEqual({
        userId: USER_ID,
        displayNameSet,
      });
    }
  });

  it.each([
    ["without the claim (issued before it existed)", {}],
    ["with a claim that is not exactly true", { dns: "true" }],
  ])("a token %s counts as no display name yet", async (_label, payload) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("music-room")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(key(SECRET));
    await expect(verifyAccessToken(token, SECRET)).resolves.toEqual({
      userId: USER_ID,
      displayNameSet: false,
    });
  });

  it("is still valid just before 15 minutes", async () => {
    const issued = new Date("2026-10-10T12:00:00Z");
    const token = await signAccessToken(
      USER_ID,
      SECRET,
      { displayNameSet: true },
      issued,
    );

    const almost = new Date(issued.getTime() + (ACCESS_TOKEN_TTL_SECONDS - 1) * 1000);
    await expect(verifyAccessToken(token, SECRET, almost)).resolves.toEqual({
      userId: USER_ID,
      displayNameSet: true,
    });
  });

  it("is reported as expired after 15 minutes (the app should refresh)", async () => {
    const issued = new Date("2026-10-10T12:00:00Z");
    const token = await signAccessToken(
      USER_ID,
      SECRET,
      { displayNameSet: true },
      issued,
    );

    const later = new Date(issued.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    await expectRejected(verifyAccessToken(token, SECRET, later), "expired");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken(USER_ID, OTHER_SECRET, { displayNameSet: true });

    await expectRejected(verifyAccessToken(token, SECRET), "invalid");
  });

  it("rejects a token whose payload was edited (e.g. another user id)", async () => {
    const token = await signAccessToken(USER_ID, SECRET, { displayNameSet: true });
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...decodePayload(token),
        sub: "11111111-1111-4111-8111-111111111111",
      }),
    ).toString("base64url");

    await expectRejected(
      verifyAccessToken(`${header}.${forgedPayload}.${signature}`, SECRET),
      "invalid",
    );
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: USER_ID,
        iss: "music-room",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      }),
    ).toString("base64url");

    await expectRejected(verifyAccessToken(`${header}.${payload}.`, SECRET), "invalid");
  });

  it("rejects a token signed with another algorithm even with the right secret (HS512)", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS512" })
      .setSubject(USER_ID)
      .setIssuer("music-room")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key(SECRET));

    await expectRejected(verifyAccessToken(token, SECRET), "invalid");
  });

  it("rejects a token from another issuer", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("someone-else")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key(SECRET));

    await expectRejected(verifyAccessToken(token, SECRET), "invalid");
  });

  it("rejects a token whose subject is not a UUID", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("admin")
      .setIssuer("music-room")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key(SECRET));

    await expectRejected(verifyAccessToken(token, SECRET), "invalid");
  });

  it("rejects a token with no expiry", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(USER_ID)
      .setIssuer("music-room")
      .setIssuedAt()
      .sign(key(SECRET));

    await expectRejected(verifyAccessToken(token, SECRET), "invalid");
  });

  it.each(["", "garbage", "a.b.c", "Bearer abc"])(
    "rejects malformed input %j",
    async (input) => {
      await expectRejected(verifyAccessToken(input, SECRET), "invalid");
    },
  );
});
