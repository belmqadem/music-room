import type { AccessLost, PlaylistSnapshot, QueueSnapshot } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import type { Server } from "socket.io";
import { noRealtime, type RealtimeEvents } from "../realtime-events.js";
import { canView } from "../modules/access/rules.js";
import { readSnapshot } from "../modules/playlist-editor/entry-repository.js";
import { toPlaylistSnapshot } from "../modules/playlist-editor/entry-service.js";
import { readQueue, type TrackRecord } from "../modules/track-vote/queue-repository.js";

// The real-time hub (ADR-019): turns "something changed" from the domain modules into
// messages to the sockets that are subscribed. Subscribers of an event sit in the
// Socket.io room "event:<id>", subscribers of a playlist in "playlist:<id>". The two kinds
// are told apart by the room NAME, so an event id can never reach a playlist's subscribers.
export type Kind = "event" | "playlist";

export const eventRoom = (eventId: string): string => `event:${eventId}`;
export const playlistRoom = (playlistId: string): string => `playlist:${playlistId}`;
export const roomOf = (kind: Kind, id: string): string =>
  kind === "event" ? eventRoom(id) : playlistRoom(id);

/** Every room a subscription lives in starts with one of these. */
export const ROOM_PREFIXES = ["event:", "playlist:"] as const;

// What differs between the two kinds, in one place: the tables that say who may see it.
const ACCESS_TABLES = {
  event: { table: "events", invitations: "event_invitations", foreignKey: "event_id" },
  playlist: {
    table: "playlists",
    invitations: "playlist_invitations",
    foreignKey: "playlist_id",
  },
} as const;

// The snapshot is the same for everybody, so it is built for nobody in particular.
// (readQueue wants a user only to fill votedByMe, which the snapshot then drops.)
const NOBODY = "00000000-0000-0000-0000-000000000000";

/** A queue entry for the whole room: everything except what is personal (votedByMe). */
function toQueueSnapshot(
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

/** What a broadcast of one kind needs: where to read the snapshot, and what to call it. */
interface Broadcast {
  /** The message name clients listen for. */
  message: "event:queue" | "playlist:updated";
  /** Reads the current snapshot, or null if the thing no longer exists. */
  read(
    pool: pg.Pool,
    id: string,
  ): Promise<{ version: number; payload: QueueSnapshot | PlaylistSnapshot } | null>;
}

const BROADCASTS: Record<Kind, Broadcast> = {
  event: {
    message: "event:queue",
    async read(pool, id) {
      const queue = await readQueue(pool, id, NOBODY);
      return queue
        ? { version: queue.version, payload: toQueueSnapshot(id, queue) }
        : null;
    },
  },
  playlist: {
    message: "playlist:updated",
    async read(pool, id) {
      const snapshot = await readSnapshot(pool, id);
      return snapshot
        ? { version: snapshot.version, payload: toPlaylistSnapshot(id, snapshot) }
        : null;
    },
  },
};

export function createRealtimeHub(deps: {
  io: Server;
  pool: pg.Pool;
  logger: Logger;
}): RealtimeEvents {
  const { pool, logger } = deps;
  const live = deps.io.of("/live");
  // One broadcast at a time per event or playlist. Changes that arrive while one is being
  // built only mark it dirty, and one more snapshot follows: a burst of 30 votes costs a few
  // reads, not 30, and the last snapshot always reflects the last change.
  const inFlight = new Map<string, { dirty: boolean }>();

  /**
   * Sends the current snapshot unless it is the one just sent. Returns the version it
   * looked at, so the caller can tell the next round what has already been sent.
   */
  async function broadcast(
    kind: Kind,
    id: string,
    alreadySent: number | null,
  ): Promise<number | null> {
    // Nobody is subscribed on this server: skip the database read. (This looks at the
    // LOCAL rooms; with several server processes the Redis adapter would need a different
    // check. See ADR-019.)
    if (!live.adapter.rooms.get(roomOf(kind, id))?.size) return alreadySent;
    const current = await BROADCASTS[kind].read(pool, id);
    if (!current) return alreadySent; // deleted meanwhile; the deletion notice handles that
    // A change that committed just before this read began still marks it dirty, so the
    // trailing read can find the very same version: do not send it twice.
    if (current.version !== alreadySent) {
      live.to(roomOf(kind, id)).emit(BROADCASTS[kind].message, current.payload);
    }
    return current.version;
  }

  async function recheckAccess(kind: Kind, id: string): Promise<void> {
    const room = roomOf(kind, id);
    const sockets = await live.in(room).fetchSockets();
    if (sockets.length === 0) return;

    const { table, invitations, foreignKey } = ACCESS_TABLES[kind];
    const { rows } = await pool.query<{
      owner_id: string;
      visibility: "public" | "private";
    }>(`SELECT owner_id, visibility FROM ${table} WHERE id = $1`, [id]);
    const found = rows[0];
    const userIds = [...new Set(sockets.map((socket) => socket.data.userId))];
    const invited = found
      ? new Set(
          (
            await pool.query<{ user_id: string }>(
              `SELECT user_id FROM ${invitations} WHERE ${foreignKey} = $1 AND user_id = ANY($2)`,
              [id, userIds],
            )
          ).rows.map((row) => row.user_id),
        )
      : new Set<string>();

    for (const socket of sockets) {
      // Only ownership and visibility decide who may SEE it (the license decides who may
      // act), so the license in this stand-in resource is never read.
      const mayStay =
        found !== undefined &&
        canView(
          {
            ownerId: found.owner_id,
            visibility: found.visibility,
            license: { type: "everyone" },
          },
          { userId: socket.data.userId, isInvited: invited.has(socket.data.userId) },
        );
      if (mayStay) continue;
      socket.leave(room);
      const lost: AccessLost = {
        resource: kind,
        id,
        reason: found ? "no_access" : "deleted",
      };
      socket.emit("event:access-lost", lost);
      logger.info(
        { socketId: socket.id, userId: socket.data.userId, kind, id },
        "socket removed",
      );
    }
  }

  const guarded = (what: string, id: string, work: () => Promise<void>): void => {
    // Never throws and never makes the caller wait: a failure to notify must not fail the request.
    work().catch((error: unknown) => logger.error({ err: error, id }, `${what} failed`));
  };

  function changed(kind: Kind, id: string): void {
    const key = roomOf(kind, id);
    const running = inFlight.get(key);
    if (running) {
      running.dirty = true;
      return;
    }
    const flight = { dirty: false };
    inFlight.set(key, flight);
    guarded(`${kind} broadcast`, id, async () => {
      try {
        let sent: number | null = null;
        do {
          flight.dirty = false;
          sent = await broadcast(kind, id, sent);
        } while (flight.dirty);
      } finally {
        inFlight.delete(key);
      }
    });
  }

  function deleted(kind: Kind, id: string): void {
    guarded(`${kind} deletion notice`, id, async () => {
      const room = roomOf(kind, id);
      const lost: AccessLost = { resource: kind, id, reason: "deleted" };
      live.to(room).emit("event:access-lost", lost);
      live.in(room).socketsLeave(room);
    });
  }

  return {
    queueChanged: (eventId) => changed("event", eventId),
    accessChanged: (eventId) =>
      guarded("access re-check", eventId, () => recheckAccess("event", eventId)),
    eventDeleted: (eventId) => deleted("event", eventId),
    playlistChanged: (playlistId) => changed("playlist", playlistId),
    playlistAccessChanged: (playlistId) =>
      guarded("access re-check", playlistId, () => recheckAccess("playlist", playlistId)),
    playlistDeleted: (playlistId) => deleted("playlist", playlistId),
  };
}

export { noRealtime };
