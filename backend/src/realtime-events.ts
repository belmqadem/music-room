// What the domain modules tell the real-time layer after they have changed something.
// Defined here, apart from Socket.io, so modules never import the socket code
// (dependencies flow one way: sockets -> modules). The implementation is
// sockets/realtime.ts; tests and tools that do not need sockets use `noRealtime`.
//
// Every method is fire-and-forget: it returns at once, never throws, and a failure
// to notify is logged by the implementation but must never fail the request that
// changed the data. Call them AFTER the database transaction has committed.
export interface RealtimeEvents {
  /** The queue of this event changed: send the new snapshot to its subscribers. */
  queueChanged(eventId: string): void;
  /** Who may see this event may have changed: remove subscribers who no longer may. */
  accessChanged(eventId: string): void;
  /** The event no longer exists: tell and remove all its subscribers. */
  eventDeleted(eventId: string): void;
}

export const noRealtime: RealtimeEvents = {
  queueChanged() {},
  accessChanged() {},
  eventDeleted() {},
};
