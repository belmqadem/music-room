import type {
  Invitation,
  MusicEvent,
  NearbyEventsResponse,
  Page,
  VoteLicense,
} from "@music-room/shared";
import { requirePremium } from "../access/plans.js";
import type pg from "pg";
import { withTransaction } from "../../db/postgres.js";
import { foreignKeyViolationOf, uniqueViolationOf } from "../../db/pg-errors.js";
import { HttpError } from "../../http-error.js";
import { noRealtime, type RealtimeEvents } from "../../realtime-events.js";
import { requireManage, requireView, toHttpError } from "../access/guards.js";
import { permissionsOf, type AccessLicense } from "../access/rules.js";
import { decodeCursor, encodeCursor } from "../../list-cursor.js";
import {
  accessOf,
  deleteEvent,
  deleteInvitation,
  findEvent,
  insertEvent,
  insertInvitation,
  listInvitations,
  listNearbyEvents,
  listVisibleEvents,
  updateEvent,
  type EventRecord,
  type InvitationRecord,
} from "./repository.js";
import { readTopTracks } from "./queue-repository.js";
import type {
  CreateEventInput,
  InviteInput,
  ListQuery,
  NearbyQuery,
  UpdateEventInput,
} from "./schema.js";

export interface EventService {
  create(userId: string, input: CreateEventInput): Promise<MusicEvent>;
  list(userId: string, query: ListQuery): Promise<Page<MusicEvent>>;
  get(userId: string, eventId: string): Promise<MusicEvent>;
  nearby(userId: string, query: NearbyQuery): Promise<NearbyEventsResponse>;
  update(userId: string, eventId: string, input: UpdateEventInput): Promise<MusicEvent>;
  remove(userId: string, eventId: string): Promise<void>;
  listInvitations(
    userId: string,
    eventId: string,
    query: ListQuery,
  ): Promise<Page<Invitation>>;
  invite(userId: string, eventId: string, input: InviteInput): Promise<Invitation>;
  removeInvitation(userId: string, eventId: string, invitedUserId: string): Promise<void>;
}

const toApiInvitation = (record: InvitationRecord): Invitation => ({
  resourceId: record.eventId,
  // Only id and display name: the owner must not see an invitee's email.
  user: { id: record.userId, displayName: record.displayName },
  invitedAt: record.invitedAt.toISOString(),
});

// Constraint names from the event_invitations migration.
const INVITATION_PRIMARY_KEY = "event_invitations_pkey";
const INVITATION_EVENT_FK = "event_invitations_event_id_fkey";
const INVITATION_USER_FK = "event_invitations_user_id_fkey";

// "Rooms near me" (ADR-052). The app watches each returned venue as a region; iOS watches at
// most 20 per app, so more would never be used.
const NEARBY_WITHIN_METERS = 10_000;
const NEARBY_HORIZON_MS = 12 * 60 * 60 * 1000;
const NEARBY_LIMIT = 20;
const NEARBY_TRACKS = 3;

/** API license (ISO strings) -> the engine's license (Dates). */
function toAccessLicense(license: VoteLicense): AccessLicense {
  if (license.type === "location_time") {
    return {
      ...license,
      startsAt: new Date(license.startsAt),
      endsAt: new Date(license.endsAt),
    };
  }
  return license;
}

function toApiLicense(license: AccessLicense): VoteLicense {
  if (license.type === "location_time") {
    return {
      ...license,
      startsAt: license.startsAt.toISOString(),
      endsAt: license.endsAt.toISOString(),
    };
  }
  return license;
}

/** The event as the app sees it. `myPermissions` is a hint; every call re-checks the rules. */
function toApiEvent(record: EventRecord, userId: string): MusicEvent {
  return {
    id: record.id,
    name: record.name,
    ownerId: record.ownerId,
    visibility: record.visibility,
    voteLicense: toApiLicense(record.license),
    createdAt: record.createdAt.toISOString(),
    myPermissions: permissionsOf(
      { ownerId: record.ownerId, visibility: record.visibility, license: record.license },
      { userId, isInvited: record.isInvited },
    ),
  };
}

/** Business rules for events. Every method checks authorization BEFORE doing the work. */
export function createEventService(deps: {
  pool: pg.Pool;
  /** Told about changes of who may see an event, after they are committed. */
  events?: RealtimeEvents;
}): EventService {
  const { pool } = deps;
  const events = deps.events ?? noRealtime;

  return {
    async create(userId, input) {
      // "At the venue" rooms are Premium (ADR-048); every other kind of room is free.
      if (input.voteLicense?.type === "location_time") await requirePremium(pool, userId);
      const record = await insertEvent(pool, userId, {
        name: input.name,
        visibility: input.visibility ?? "public",
        license: toAccessLicense(input.voteLicense ?? { type: "everyone" }),
      });
      return toApiEvent(record, userId);
    },

    async list(userId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      // One extra row tells us whether another page exists.
      const rows = await listVisibleEvents(pool, userId, {
        limit: query.limit + 1,
        after,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((record) => toApiEvent(record, userId)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id })
            : null,
      };
    },

    async get(userId, eventId) {
      const record = await findEvent(pool, eventId, userId);
      if (!record) throw toHttpError("event", "NOT_FOUND");
      const { resource, subject } = accessOf(record, userId);
      requireView("event", resource, subject);
      return toApiEvent(record, userId);
    },

    // Authorization: only public rooms are ever returned (the query's own condition), and every
    // signed-in user may see a public room. The point is used for this query only: it is not
    // stored, and the request log never writes query strings (request-logger.ts).
    async nearby(userId, query) {
      const now = Date.now();
      const records = await listNearbyEvents(pool, userId, query, {
        withinMeters: NEARBY_WITHIN_METERS,
        from: new Date(now),
        until: new Date(now + NEARBY_HORIZON_MS),
        limit: NEARBY_LIMIT,
      });
      const tracks = await readTopTracks(
        pool,
        records.map((record) => record.id),
        NEARBY_TRACKS,
      );
      return {
        items: records.map((record) => ({
          event: toApiEvent(record, userId),
          distanceMeters: Math.round(record.distanceMeters),
          tracks: (tracks.get(record.id) ?? []).map((track) => ({
            providerTrackId: track.providerTrackId,
            title: track.title,
            artist: track.artist,
            durationSeconds: track.durationSeconds,
            coverUrl: track.coverUrl,
          })),
        })),
      };
    },

    async update(userId, eventId, input) {
      let visibilityChanged = false;
      const result = await withTransaction(pool, async (client) => {
        visibilityChanged = false; // the work may run again after a deadlock retry
        // Lock the row: two simultaneous PATCHes (one changing the name, one the
        // visibility) run one after the other, so neither overwrites the other.
        const current = await findEvent(client, eventId, userId, { lock: "update" });
        if (!current) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("event", resource, subject);
        // Setting an "At the venue" license is Premium (ADR-048). A room that already has one
        // keeps working, and its owner can still rename it or make it free to vote in.
        if (input.voteLicense?.type === "location_time")
          await requirePremium(client, userId);

        await updateEvent(client, eventId, {
          name: input.name ?? current.name,
          visibility: input.visibility ?? current.visibility,
          license: input.voteLicense
            ? toAccessLicense(input.voteLicense)
            : current.license,
        });
        const updated = await findEvent(client, eventId, userId);
        if (!updated)
          throw new HttpError(500, "INTERNAL_ERROR", "Event vanished during update.");
        visibilityChanged = updated.visibility !== current.visibility;
        return toApiEvent(updated, userId);
      });
      // Only a change of visibility changes who may SEE the event (the license does not).
      if (visibilityChanged) events.accessChanged(eventId);
      return result;
    },

    async remove(userId, eventId) {
      await withTransaction(pool, async (client) => {
        const current = await findEvent(client, eventId, userId, { lock: "update" });
        if (!current) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("event", resource, subject);
        await deleteEvent(client, eventId);
      });
      events.eventDeleted(eventId);
    },

    async listInvitations(userId, eventId, query) {
      const current = await findEvent(pool, eventId, userId);
      if (!current) throw toHttpError("event", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("event", resource, subject); // only the owner sees who is invited

      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await listInvitations(pool, eventId, {
        limit: query.limit + 1,
        after,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toApiInvitation),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.invitedAtCursor, id: last.userId })
            : null,
      };
    },

    async invite(userId, eventId, input) {
      const current = await findEvent(pool, eventId, userId);
      if (!current) throw toHttpError("event", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("event", resource, subject);

      if (input.userId === current.ownerId) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "The owner is always allowed; no invitation needed.",
        );
      }
      try {
        return toApiInvitation(await insertInvitation(pool, eventId, input.userId));
      } catch (error) {
        // The database decides, so two simultaneous invites cannot both succeed.
        if (uniqueViolationOf(error) === INVITATION_PRIMARY_KEY) {
          throw new HttpError(409, "ALREADY_INVITED", "This user is already invited.");
        }
        const foreignKey = foreignKeyViolationOf(error);
        if (foreignKey === INVITATION_USER_FK) {
          throw new HttpError(404, "NOT_FOUND", "User not found.");
        }
        // The event was deleted between our check and the insert.
        if (foreignKey === INVITATION_EVENT_FK) throw toHttpError("event", "NOT_FOUND");
        throw error;
      }
    },

    async removeInvitation(userId, eventId, invitedUserId) {
      const current = await findEvent(pool, eventId, userId);
      if (!current) throw toHttpError("event", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("event", resource, subject);
      // Idempotent: removing an invitation that is already gone is not an error.
      await deleteInvitation(pool, eventId, invitedUserId);
      // A private event stops being visible to that user: close their live channel too.
      events.accessChanged(eventId);
    },
  };
}
