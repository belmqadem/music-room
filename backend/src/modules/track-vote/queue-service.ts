import type { EventQueueUpdate, EventTrack } from "@music-room/shared";
import type pg from "pg";
import type { Logger } from "pino";
import { uniqueViolationOf } from "../../db/pg-errors.js";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { requireAct, requireView, toHttpError } from "../access/guards.js";
import { CatalogUnavailableError, type CatalogProvider } from "./catalog.js";
import { accessOf, findEvent } from "./repository.js";
import {
  adjustVoteCount,
  bumpQueueVersion,
  deleteVote,
  findQueuedByProviderTrack,
  findTrack,
  insertSuggestedTrack,
  insertVote,
  readQueue,
  type TrackRecord,
} from "./queue-repository.js";
import type { SuggestTrackInput, VoteBodyInput } from "./schema.js";

export interface QueueService {
  getQueue(userId: string, eventId: string): Promise<EventQueueUpdate>;
  suggest(userId: string, eventId: string, input: SuggestTrackInput): Promise<EventTrack>;
  vote(
    userId: string,
    eventId: string,
    trackId: string,
    input: VoteBodyInput,
  ): Promise<EventTrack>;
  withdrawVote(userId: string, eventId: string, trackId: string): Promise<EventTrack>;
}

// Name of the partial unique index in the event_tracks migration.
const ONE_QUEUED_PER_SONG = "event_tracks_one_queued_per_provider_track";

export function toApiTrack(record: TrackRecord): EventTrack {
  return {
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
    votedByMe: record.votedByMe,
    status: record.status,
    suggestedAt: record.suggestedAt.toISOString(),
  };
}

const trackNotFound = () => new HttpError(404, "TRACK_NOT_FOUND", "Track not found.");

/**
 * Suggesting, voting and reading the queue of an event (ADR-008, ADR-014, ADR-016).
 *
 * Every request that CHANGES the queue follows the same recipe:
 *  1. a cheap permission check with no lock, so a forbidden user is turned away
 *     before they can make us call the catalog or wait for the event's lock;
 *  2. one transaction that locks the event row FIRST (so these requests, and the
 *     owner's edits, run one after the other and can never deadlock), checks the
 *     permission again on the locked, fresh data, then changes the tracks and votes;
 *  3. the queue version is raised only when something really changed.
 */
export function createQueueService(deps: {
  pool: pg.Pool;
  catalog: CatalogProvider;
  logger: Logger;
  /** Tests only: the server clock the location_time window is judged by. */
  clock?: () => Date;
}): QueueService {
  const { pool, catalog, logger } = deps;
  const now = deps.clock ?? (() => new Date());

  return {
    async getQueue(userId, eventId) {
      const event = await findEvent(pool, eventId, userId);
      if (!event) throw toHttpError("event", "NOT_FOUND");
      const { resource, subject } = accessOf(event, userId);
      requireView("event", resource, subject);

      const queue = await readQueue(pool, eventId, userId);
      if (!queue) throw toHttpError("event", "NOT_FOUND"); // deleted a moment ago
      return { eventId, version: queue.version, tracks: queue.tracks.map(toApiTrack) };
    },

    async suggest(userId, eventId, input) {
      const context = () => ({ now: now(), position: input.location });

      // 1. Early check, no lock: not allowed means no catalog call at all.
      const early = await findEvent(pool, eventId, userId);
      if (!early) throw toHttpError("event", "NOT_FOUND");
      const earlyAccess = accessOf(early, userId);
      requireAct("event", earlyAccess.resource, earlyAccess.subject, context());

      // The catalog is a network call: done outside any transaction, so no database
      // connection or lock waits on a third party.
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
      if (!track) throw trackNotFound();

      // 2. The change itself.
      try {
        return await withTransaction(pool, async (client) => {
          const event = await findEvent(client, eventId, userId, { lock: "no-key" });
          if (!event) throw toHttpError("event", "NOT_FOUND");
          const { resource, subject } = accessOf(event, userId);
          requireAct("event", resource, subject, context());

          const record = await insertSuggestedTrack(client, {
            eventId,
            suggestedBy: userId,
            providerTrackId: track.providerTrackId,
            title: track.title,
            artist: track.artist,
            durationSeconds: track.durationSeconds,
            coverUrl: track.coverUrl,
          });
          await bumpQueueVersion(client, eventId);
          return toApiTrack(record);
        });
      } catch (error) {
        // The song is already queued (someone suggested it just before us). The
        // database decides, so this also holds if two requests ever do overlap.
        if (uniqueViolationOf(error) === ONE_QUEUED_PER_SONG) {
          const existing = await findQueuedByProviderTrack(
            pool,
            eventId,
            track.providerTrackId,
            userId,
          );
          throw new HttpError(
            409,
            "TRACK_ALREADY_QUEUED",
            "This track is already in the queue. Vote for it instead.",
            existing ? toApiTrack(existing) : null,
          );
        }
        throw error;
      }
    },

    async vote(userId, eventId, trackId, input) {
      const context = () => ({ now: now(), position: input.location });

      const early = await findEvent(pool, eventId, userId);
      if (!early) throw toHttpError("event", "NOT_FOUND");
      const earlyAccess = accessOf(early, userId);
      requireAct("event", earlyAccess.resource, earlyAccess.subject, context());

      return withTransaction(pool, async (client) => {
        const event = await findEvent(client, eventId, userId, { lock: "no-key" });
        if (!event) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(event, userId);
        requireAct("event", resource, subject, context());

        const track = await findTrack(client, eventId, trackId, userId);
        if (!track) throw trackNotFound();
        if (track.status !== "queued") {
          throw new HttpError(
            409,
            "TRACK_NOT_VOTABLE",
            "This track can no longer be voted for.",
          );
        }

        // Idempotent: voting again changes nothing, not the count and not the version.
        if (!(await insertVote(client, trackId, userId))) {
          return toApiTrack({ ...track, votedByMe: true });
        }
        const voteCount = await adjustVoteCount(client, trackId, 1);
        await bumpQueueVersion(client, eventId);
        return toApiTrack({ ...track, voteCount, votedByMe: true });
      });
    },

    async withdrawVote(userId, eventId, trackId) {
      // Taking back your OWN vote needs only that you can still see the event, not the
      // license: someone who voted and then left the area, or lost their invitation,
      // must be able to undo it. (Decided; see the contract.)
      const early = await findEvent(pool, eventId, userId);
      if (!early) throw toHttpError("event", "NOT_FOUND");
      const earlyAccess = accessOf(early, userId);
      requireView("event", earlyAccess.resource, earlyAccess.subject);

      return withTransaction(pool, async (client) => {
        const event = await findEvent(client, eventId, userId, { lock: "no-key" });
        if (!event) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(event, userId);
        requireView("event", resource, subject);

        const track = await findTrack(client, eventId, trackId, userId);
        if (!track) throw trackNotFound();
        if (track.status !== "queued") {
          throw new HttpError(
            409,
            "TRACK_NOT_VOTABLE",
            "This track can no longer be voted for.",
          );
        }

        if (!(await deleteVote(client, trackId, userId))) {
          return toApiTrack({ ...track, votedByMe: false });
        }
        const voteCount = await adjustVoteCount(client, trackId, -1);
        await bumpQueueVersion(client, eventId);
        return toApiTrack({ ...track, voteCount, votedByMe: false });
      });
    },
  };
}
