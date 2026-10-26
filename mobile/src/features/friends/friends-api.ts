import type { Friendship, Page } from "@music-room/shared";
import { auth } from "@/auth";

// The friends endpoints (docs/api-contract.md, "Friends"; ADR-023). Everything is from the caller's
// side: the server answers only about the caller's own requests and friendships. Ids are encoded:
// one can come from a link, and must not be able to point the call at another path.
export const friendsApi = {
  /** Asks someone. If they had already asked you, you are friends at once (200, `accepted`). */
  send: (userId: string) =>
    auth.request<Friendship>("POST", "/friends/requests", { body: { userId } }),
  /** Only the person who was asked can accept. */
  accept: (requestId: string) =>
    auth.request<Friendship>(
      "POST",
      `/friends/requests/${encodeURIComponent(requestId)}/accept`,
    ),
  /** Declines a request you received, or cancels one you sent. */
  removeRequest: (requestId: string) =>
    auth.request("DELETE", `/friends/requests/${encodeURIComponent(requestId)}`),
  unfriend: (userId: string) =>
    auth.request("DELETE", `/friends/${encodeURIComponent(userId)}`),
  requests: (direction: "incoming" | "outgoing", cursor?: string) =>
    auth.request<Page<Friendship>>("GET", "/friends/requests", {
      query: { direction, limit: 20, cursor },
    }),
  friends: (cursor?: string) =>
    auth.request<Page<Friendship>>("GET", "/friends", { query: { limit: 20, cursor } }),
};
