import { describe, expect, it } from "vitest";
import { decodeUserCursor, encodeUserCursor } from "../../src/modules/users/cursor.js";
import { escapeLikePattern } from "../../src/modules/users/repository.js";
import { searchQuerySchema } from "../../src/modules/users/schema.js";

describe("searchQuerySchema", () => {
  it("trims the query and defaults the limit", () => {
    expect(searchQuerySchema.parse({ query: "  ada  " })).toEqual({
      query: "ada",
      limit: 20,
    });
  });

  it.each(["", "a", "ab", "  ab  ", "   "])("rejects the too-short query %j", (query) => {
    expect(searchQuerySchema.safeParse({ query }).success).toBe(false);
  });

  it("requires a query at all, and caps its length at 50", () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
    expect(searchQuerySchema.safeParse({ query: "x".repeat(51) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ query: "x".repeat(50) }).success).toBe(true);
  });

  it("accepts exactly 3 characters", () => {
    expect(searchQuerySchema.safeParse({ query: "ada" }).success).toBe(true);
  });

  it.each(["0", "101", "abc", "-1"])("rejects the limit %j", (limit) => {
    expect(searchQuerySchema.safeParse({ query: "ada", limit }).success).toBe(false);
  });
});

describe("escapeLikePattern", () => {
  it("escapes the three characters LIKE treats specially", () => {
    expect(escapeLikePattern("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("Ada Lovelace é")).toBe("Ada Lovelace é");
  });
});

describe("user search cursor", () => {
  const cursor = { name: "ada lovelace", id: "00000000-0000-4000-8000-000000000001" };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  it("survives a round trip, including non-ASCII names", () => {
    expect(decodeUserCursor(encodeUserCursor(cursor))).toEqual(cursor);
    const accented = { ...cursor, name: "éloïse 🎵" };
    expect(decodeUserCursor(encodeUserCursor(accented))).toEqual(accented);
  });

  it.each([
    ["garbage", "%%%"],
    ["a missing id", encode({ n: "x" })],
    ["an id that is not a uuid", encode({ n: "x", i: "1" })],
    ["an extra field", encode({ n: "x", i: cursor.id, z: 1 })],
    ["an oversized name", encode({ n: "x".repeat(201), i: cursor.id })],
  ])("rejects %s with a 400", (_label, raw) => {
    expect(() => decodeUserCursor(raw)).toThrowError(
      expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }),
    );
  });
});
