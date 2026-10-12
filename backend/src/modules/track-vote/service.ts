import type { MusicEvent, Page, VoteLicense } from "@music-room/shared";
import type pg from "pg";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { requireManage, requireView, toHttpError } from "../access/guards.js";
import { permissionsOf, type AccessLicense } from "../access/rules.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  deleteEvent,
  findEvent,
  insertEvent,
  listVisibleEvents,
  updateEvent,
  type EventRecord,
} from "./repository.js";
import type { CreateEventInput, ListQuery, UpdateEventInput } from "./schema.js";

export interface EventService {
  create(userId: string, input: CreateEventInput): Promise<MusicEvent>;
  list(userId: string, query: ListQuery): Promise<Page<MusicEvent>>;
  get(userId: string, eventId: string): Promise<MusicEvent>;
  update(userId: string, eventId: string, input: UpdateEventInput): Promise<MusicEvent>;
  remove(userId: string, eventId: string): Promise<void>;
}

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

const accessOf = (record: EventRecord, userId: string) => ({
  resource: {
    ownerId: record.ownerId,
    visibility: record.visibility,
    license: record.license,
  },
  subject: { userId, isInvited: record.isInvited },
});

/** Business rules for events. Every method checks authorization BEFORE doing the work. */
export function createEventService(deps: { pool: pg.Pool }): EventService {
  const { pool } = deps;

  return {
    async create(userId, input) {
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

    async update(userId, eventId, input) {
      return withTransaction(pool, async (client) => {
        // Lock the row: two simultaneous PATCHes (one changing the name, one the
        // visibility) run one after the other, so neither overwrites the other.
        const current = await findEvent(client, eventId, userId, { lock: true });
        if (!current) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("event", resource, subject);

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
        return toApiEvent(updated, userId);
      });
    },

    async remove(userId, eventId) {
      await withTransaction(pool, async (client) => {
        const current = await findEvent(client, eventId, userId, { lock: true });
        if (!current) throw toHttpError("event", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("event", resource, subject);
        await deleteEvent(client, eventId);
      });
    },
  };
}
