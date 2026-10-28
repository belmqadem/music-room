// API contract: Socket.io namespace "/live". Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Real-time events") and ADR-019.
import type { ApiErrorCode } from "./api-error";
import type { PlaylistSnapshot } from "./playlist";
import type { EventQueueUpdate } from "./vote";

/** Client -> server `subscribe` and `unsubscribe`. */
export interface SubscribeRequest {
  resource: "event" | "playlist";
  id: string; // UUID
}

/**
 * The acknowledgement of `subscribe`: the current state, or why not. For an event it is the
 * queue as YOU see it (with your votedByMe); for a playlist it is the ordered tracks.
 * The shape follows the `resource` you subscribed to.
 */
export type SubscribeAck =
  | { ok: true; snapshot: EventQueueUpdate | PlaylistSnapshot }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

/** The acknowledgement of `unsubscribe`. */
export type UnsubscribeAck =
  { ok: true } | { ok: false; error: { code: ApiErrorCode; message: string } };

/** Server -> client `event:access-lost`: you are no longer in this event's channel. */
export interface AccessLost {
  resource: "event" | "playlist";
  id: string;
  reason: "no_access" | "deleted";
}
