import type { AccessLost, QueueSnapshot } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import type { Server } from "socket.io";
import { noRealtime, type RealtimeEvents } from "../realtime-events.js";
import { canView } from "../modules/access/rules.js";
import { readQueue, type TrackRecord } from "../modules/track-vote/queue-repository.js";

// The real-time hub (ADR-019): turns "something changed" from the domain modules into
// messages to the sockets that are subscribed. Subscribers of an event sit in the
// Socket.io room "event:<id>".
export const eventRoom = (eventId: string): string => `event:${eventId}`;

// The queue snapshot is the same for everybody, so it is built for nobody in particular.
// (readQueue wants a user only to fill votedByMe, which the snapshot then drops.)
const NOBODY = "00000000-0000-0000-0000-000000000000";

/** A queue entry for the whole room: everything except what is personal (votedByMe). */
function toSnapshot(
  eventId: string,
  queue: { version: number; tracks: TrackRecord[] },
): QueueSnapshot {
  return {
    eventId,
    version: queue.version,
    tracks: queue.tracks.map((record) => ({
      id: record.id,
      eventId: record.eventId,
      track: {
        providerTrackId: record.providerTrackId,
        title: record.title,
        artist: record.artist,
        durationSeconds: record.durationSeconds,
        coverUrl: record.coverUrl,
      },
      suggestedBy: record.suggestedBy,
      voteCount: record.voteCount,
      status: record.status,
      suggestedAt: record.suggestedAt.toISOString(),
    })),
  };
}

export function createRealtimeHub(deps: {
  io: Server;
  pool: pg.Pool;
  logger: Logger;
}): RealtimeEvents {
  const { pool, logger } = deps;
  const live = deps.io.of("/live");
  // One broadcast at a time per event. Changes that arrive while one is being built only
  // mark the event dirty, and one more snapshot follows: a burst of 30 votes costs a few
  // reads, not 30, and the last snapshot always reflects the last change.
  const inFlight = new Map<string, { dirty: boolean }>();

  /**
   * Sends the current snapshot unless it is the one just sent. Returns the version it
   * looked at, so the caller can tell the next round what has already been sent.
   */
  async function broadcastQueue(
    eventId: string,
    alreadySent: number | null,
  ): Promise<number | null> {
    // Nobody is subscribed on this server: skip the database read. (This looks at the
    // LOCAL rooms; with several server processes the Redis adapter would need a different
    // check. See ADR-019.)
    if (!live.adapter.rooms.get(eventRoom(eventId))?.size) return alreadySent;
    const queue = await readQueue(pool, eventId, NOBODY);
    if (!queue) return alreadySent; // the event was deleted meanwhile; eventDeleted handles that
    // A change that committed just before this read began still marks the event dirty,
    // so the trailing read can find the very same version: do not send it twice.
    if (queue.version !== alreadySent) {
      live.to(eventRoom(eventId)).emit("event:queue", toSnapshot(eventId, queue));
    }
    return queue.version;
  }

  async function recheckAccess(eventId: string): Promise<void> {
    const room = eventRoom(eventId);
    const sockets = await live.in(room).fetchSockets();
    if (sockets.length === 0) return;

    const { rows } = await pool.query<{
      owner_id: string;
      visibility: "public" | "private";
    }>("SELECT owner_id, visibility FROM events WHERE id = $1", [eventId]);
    const event = rows[0];
    const userIds = [...new Set(sockets.map((socket) => socket.data.userId))];
    const invited = event
      ? new Set(
          (
            await pool.query<{ user_id: string }>(
              "SELECT user_id FROM event_invitations WHERE event_id = $1 AND user_id = ANY($2)",
              [eventId, userIds],
            )
          ).rows.map((row) => row.user_id),
        )
      : new Set<string>();

    for (const socket of sockets) {
      // Only ownership and visibility decide who may SEE an event (the license decides who
      // may act), so the license in this stand-in resource is never read.
      const mayStay =
        event !== undefined &&
        canView(
          {
            ownerId: event.owner_id,
            visibility: event.visibility,
            license: { type: "everyone" },
          },
          { userId: socket.data.userId, isInvited: invited.has(socket.data.userId) },
        );
      if (mayStay) continue;
      socket.leave(room);
      const lost: AccessLost = {
        resource: "event",
        id: eventId,
        reason: event ? "no_access" : "deleted",
      };
      socket.emit("event:access-lost", lost);
      logger.info(
        { socketId: socket.id, userId: socket.data.userId, eventId },
        "socket removed from event",
      );
    }
  }

  const guarded = (what: string, eventId: string, work: () => Promise<void>): void => {
    // Never throws and never makes the caller wait: a failure to notify must not fail the request.
    work().catch((error: unknown) =>
      logger.error({ err: error, eventId }, `${what} failed`),
    );
  };

  return {
    queueChanged(eventId) {
      const running = inFlight.get(eventId);
      if (running) {
        running.dirty = true;
        return;
      }
      const flight = { dirty: false };
      inFlight.set(eventId, flight);
      guarded("queue broadcast", eventId, async () => {
        try {
          let sent: number | null = null;
          do {
            flight.dirty = false;
            sent = await broadcastQueue(eventId, sent);
          } while (flight.dirty);
        } finally {
          inFlight.delete(eventId);
        }
      });
    },

    accessChanged(eventId) {
      guarded("access re-check", eventId, () => recheckAccess(eventId));
    },

    eventDeleted(eventId) {
      guarded("event deletion notice", eventId, async () => {
        const room = eventRoom(eventId);
        const lost: AccessLost = { resource: "event", id: eventId, reason: "deleted" };
        live.to(room).emit("event:access-lost", lost);
        live.in(room).socketsLeave(room);
      });
    },
  };
}

export { noRealtime };
