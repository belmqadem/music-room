// API contract: Socket.io namespace "/live". Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Real-time events") and ADR-019.
import type { ApiErrorCode } from "./api-error";
import type { EventQueueUpdate } from "./vote";

/** Client -> server `subscribe` and `unsubscribe`. */
export interface SubscribeRequest {
  resource: "event" | "playlist"; // "playlist" is answered NOT_FOUND until the Playlist Editor exists
  id: string; // UUID
}

/** The acknowledgement of `subscribe`: the current queue (with YOUR votedByMe), or why not. */
export type SubscribeAck =
  | { ok: true; snapshot: EventQueueUpdate }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

/** The acknowledgement of `unsubscribe`. */
export type UnsubscribeAck =
  { ok: true } | { ok: false; error: { code: ApiErrorCode; message: string } };

/** Server -> client `event:access-lost`: you are no longer in this event's channel. */
export interface AccessLost {
  resource: "event";
  id: string;
  reason: "no_access" | "deleted";
}
