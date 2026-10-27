import type { Plan } from "@music-room/shared";
import type pg from "pg";
import { HttpError } from "../../http-error.js";

// SECURITY (ADR-048): what needs Premium is decided HERE, on the server, for every request. The
// app hides what a free user cannot do, but that is only a convenience: a client can send
// anything. The plan is read from the database at the moment of the request (not from the access
// token), so a switch counts from the very next request.
//
// Needs Premium: creating a playlist, changing its settings, inviting to it, adding, moving and
// removing its tracks; creating an "At the venue" room or turning a room into one.
// Never needs it: seeing anything, voting and suggesting in any room, deleting your own playlist
// or room, removing invitations. You can always shrink what you own, never build on it.

type Queryable = Pick<pg.Pool, "query">;

export async function planOf(db: Queryable, userId: string): Promise<Plan> {
  const { rows } = await db.query<{ plan: Plan }>(
    "SELECT plan FROM users WHERE id = $1",
    [userId],
  );
  // A deleted user with a still valid token is not Premium.
  return rows[0]?.plan ?? "free";
}

/**
 * Throws 403 PREMIUM_REQUIRED unless the user is on Premium. Services call it AFTER their
 * visibility and permission checks, so a hidden resource still answers 404 and its existence is
 * not revealed by the plan check.
 */
export async function requirePremium(db: Queryable, userId: string): Promise<void> {
  if ((await planOf(db, userId)) !== "premium") {
    throw new HttpError(403, "PREMIUM_REQUIRED", "This needs Premium.");
  }
}
