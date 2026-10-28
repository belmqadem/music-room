import { describe, expect, it } from "vitest";
import {
  friendRequestSchema,
  idSchema,
  listQuerySchema,
  requestsQuerySchema,
} from "../../src/modules/friends/schema.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("friend schemas", () => {
  it("friendRequestSchema takes exactly a user id", () => {
    expect(friendRequestSchema.parse({ userId: ID })).toEqual({ userId: ID });
    for (const body of [
      {},
      { userId: "x" },
      { userId: ID, status: "accepted" },
      null,
      "text",
    ]) {
      expect(friendRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("idSchema accepts a UUID only", () => {
    expect(idSchema.safeParse(ID).success).toBe(true);
    expect(idSchema.safeParse("1").success).toBe(false);
    expect(idSchema.safeParse(undefined).success).toBe(false);
  });

  it("listQuerySchema defaults the limit to 20 and bounds it to 1..100", () => {
    expect(listQuerySchema.parse({}).limit).toBe(20);
    expect(listQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(listQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("requestsQuerySchema requires incoming or outgoing", () => {
    expect(requestsQuerySchema.parse({ direction: "incoming" }).direction).toBe(
      "incoming",
    );
    expect(requestsQuerySchema.parse({ direction: "outgoing" }).direction).toBe(
      "outgoing",
    );
    expect(requestsQuerySchema.safeParse({}).success).toBe(false);
    expect(requestsQuerySchema.safeParse({ direction: "both" }).success).toBe(false);
  });
});
