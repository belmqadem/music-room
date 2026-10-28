// API contract: friends. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Friends") and ADR-023.
import type { UserSummary } from "./user";

/**
 * A friendship between the caller and `user`, seen from the caller's side.
 * `pending` = waiting for the addressee; `accepted` = they are friends.
 */
export interface Friendship {
  id: string; // UUID of the request / friendship
  user: UserSummary; // the OTHER person; never an email
  status: "pending" | "accepted";
  /** Who asked: "outgoing" = the caller sent it, "incoming" = the caller received it. */
  direction: "incoming" | "outgoing";
  createdAt: string; // ISO 8601 UTC, when the request was sent
  respondedAt: string | null; // ISO 8601 UTC, when it was accepted
}

/** Body of POST /friends/requests. */
export interface FriendRequestBody {
  userId: string;
}
