import type { PlaylistEntry, PlaylistSnapshot } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { requireAct, requireView, toHttpError } from "../access/guards.js";
import { CatalogUnavailableError, type CatalogProvider } from "../track-vote/catalog.js";
import {
  bumpPlaylistVersion,
  countEntries,
  findEntryPosition,
  insertEntryAt,
  MAX_ENTRIES,
  moveEntry,
  readSnapshot,
  removeEntryAt,
  type EntryRecord,
  type SnapshotRecord,
} from "./entry-repository.js";
import { accessOf, findPlaylist } from "./repository.js";
import type { AddTrackInput, MoveTrackInput } from "./schema.js";

export interface EntryService {
  getSnapshot(userId: string, playlistId: string): Promise<PlaylistSnapshot>;
  add(
    userId: string,
    playlistId: string,
    input: AddTrackInput,
  ): Promise<PlaylistSnapshot>;
  move(
    userId: string,
    playlistId: string,
    entryId: string,
    input: MoveTrackInput,
  ): Promise<PlaylistSnapshot>;
  remove(userId: string, playlistId: string, entryId: string): Promise<PlaylistSnapshot>;
}

const toApiEntry = (record: EntryRecord): PlaylistEntry => ({
  id: record.id,
  track: {
    providerTrackId: record.providerTrackId,
    title: record.title,
    artist: record.artist,
    durationSeconds: record.durationSeconds,
    coverUrl: record.coverUrl,
  },
  addedBy: record.addedBy,
  addedAt: record.addedAt.toISOString(),
});

// Positions are an internal detail: clients get the list in order and never a number.
function toSnapshot(playlistId: string, snapshot: SnapshotRecord): PlaylistSnapshot {
  return {
    playlistId,
    version: snapshot.version,
    tracks: snapshot.entries.map(toApiEntry),
  };
}

const entryNotFound = () => new HttpError(404, "TRACK_NOT_FOUND", "Entry not found.");
const anchorNotFound = () =>
  new HttpError(
    409,
    "ANCHOR_NOT_FOUND",
    "The track to place it after is not in this playlist.",
  );
const playlistFull = () =>
  new HttpError(409, "PLAYLIST_FULL", `A playlist holds at most ${MAX_ENTRIES} tracks.`);

/**
 * Editing the tracks of a playlist (ADR-009, ADR-018, ADR-020). Every edit follows the same
 * recipe as the event queue:
 *  1. a cheap permission check with no lock, so a forbidden user is turned away before they
 *     can make us call the catalog or wait for the playlist's lock;
 *  2. one transaction that locks the playlist row FIRST, checks the permission again on the
 *     fresh data, and only then rewrites the entries;
 *  3. the version is raised only when the list really changed.
 */
export function createEntryService(deps: {
  pool: pg.Pool;
  catalog: CatalogProvider;
  logger: Logger;
}): EntryService {
  const { pool, catalog, logger } = deps;
  const context = () => ({ now: new Date() }); // playlists have no time or place rule

  /** The playlist as `userId` is allowed to edit it, or the HTTP error that says why not. */
  async function requireEditable(
    db: Pick<pg.Pool, "query">,
    userId: string,
    playlistId: string,
    lock?: "no-key",
  ) {
    const playlist = await findPlaylist(db, playlistId, userId, lock ? { lock } : {});
    if (!playlist) throw toHttpError("playlist", "NOT_FOUND");
    const { resource, subject } = accessOf(playlist, userId);
    requireAct("playlist", resource, subject, context());
  }

  async function currentSnapshot(db: Pick<pg.Pool, "query">, playlistId: string) {
    const snapshot = await readSnapshot(db, playlistId);
    if (!snapshot) throw toHttpError("playlist", "NOT_FOUND"); // deleted a moment ago
    return toSnapshot(playlistId, snapshot);
  }

  return {
    async getSnapshot(userId, playlistId) {
      const playlist = await findPlaylist(pool, playlistId, userId);
      if (!playlist) throw toHttpError("playlist", "NOT_FOUND");
      const { resource, subject } = accessOf(playlist, userId);
      requireView("playlist", resource, subject);
      return currentSnapshot(pool, playlistId);
    },

    async add(userId, playlistId, input) {
      // 1. Early checks, no lock: not allowed, or no room left, means no catalog call at all.
      await requireEditable(pool, userId, playlistId);
      if ((await countEntries(pool, playlistId)) >= MAX_ENTRIES) throw playlistFull();

      // The catalog is a network call: outside any transaction, so no connection or lock waits on it.
      let track;
      try {
        track = await catalog.getTrack(input.providerTrackId);
      } catch (error) {
        if (error instanceof CatalogUnavailableError) {
          logger.error({ reason: error.message }, "music catalog unavailable");
          throw new HttpError(
            502,
            "PROVIDER_UNAVAILABLE",
            "The music catalog could not be reached. Try again later.",
          );
        }
        throw error;
      }
      if (!track) throw new HttpError(404, "TRACK_NOT_FOUND", "Track not found.");

      // 2. The change itself.
      return withTransaction(pool, async (client) => {
        await requireEditable(client, userId, playlistId, "no-key");

        const size = await countEntries(client, playlistId);
        if (size >= MAX_ENTRIES) throw playlistFull();
        let position = size; // at the end
        if (input.afterEntryId !== undefined) {
          const anchor = await findEntryPosition(client, playlistId, input.afterEntryId);
          if (anchor === null) throw anchorNotFound();
          position = anchor + 1;
        }

        await insertEntryAt(
          client,
          {
            playlistId,
            addedBy: userId,
            providerTrackId: track.providerTrackId,
            title: track.title,
            artist: track.artist,
            durationSeconds: track.durationSeconds,
            coverUrl: track.coverUrl,
          },
          position,
        );
        await bumpPlaylistVersion(client, playlistId);
        return currentSnapshot(client, playlistId);
      });
    },

    async move(userId, playlistId, entryId, input) {
      await requireEditable(pool, userId, playlistId);

      return withTransaction(pool, async (client) => {
        await requireEditable(client, userId, playlistId, "no-key");

        const from = await findEntryPosition(client, playlistId, entryId);
        if (from === null) throw entryNotFound();

        let to = 0; // null means "to the start"
        if (input.afterEntryId !== null) {
          // Moving an entry after itself changes nothing.
          if (input.afterEntryId === entryId) return currentSnapshot(client, playlistId);
          const anchor = await findEntryPosition(client, playlistId, input.afterEntryId);
          if (anchor === null) throw anchorNotFound();
          // Taking the entry out first shifts a later anchor one place up.
          to = anchor < from ? anchor + 1 : anchor;
        }
        // Already in that place: nothing to do, and the version must not move.
        if (to === from) return currentSnapshot(client, playlistId);

        await moveEntry(client, playlistId, entryId, from, to);
        await bumpPlaylistVersion(client, playlistId);
        return currentSnapshot(client, playlistId);
      });
    },

    async remove(userId, playlistId, entryId) {
      await requireEditable(pool, userId, playlistId);

      return withTransaction(pool, async (client) => {
        await requireEditable(client, userId, playlistId, "no-key");

        const position = await findEntryPosition(client, playlistId, entryId);
        // Already gone (or never here): not an error, and the version stays.
        if (position === null) return currentSnapshot(client, playlistId);

        await removeEntryAt(client, playlistId, entryId, position);
        await bumpPlaylistVersion(client, playlistId);
        return currentSnapshot(client, playlistId);
      });
    },
  };
}
