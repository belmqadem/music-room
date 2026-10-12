import type pg from "pg";
import { eventLicenseFromColumns } from "../access/repository.js";
import type { AccessLicense } from "../access/rules.js";
import type { ListCursor } from "./cursor.js";

// All SQL for events lives here. Functions take `db` so the caller decides
// whether they run on the pool or inside a transaction.
type Queryable = Pick<pg.Pool, "query">;

export interface EventRecord {
  id: string;
  ownerId: string;
  name: string;
  visibility: "public" | "private";
  license: AccessLicense;
  createdAt: Date;
  /** created_at exactly as Postgres prints it (microseconds), for list cursors. */
  createdAtCursor: string;
  /** Whether the user the query was run for is on the invitation list. */
  isInvited: boolean;
}

export interface EventValues {
  name: string;
  visibility: "public" | "private";
  license: AccessLicense;
}

interface EventRow {
  id: string;
  owner_id: string;
  name: string;
  visibility: "public" | "private";
  vote_license: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  created_at: Date;
  created_at_cursor: string;
  is_invited: boolean;
}

// $1 is always the user the query is run for.
const EVENT_SELECT = `
  e.id, e.owner_id, e.name, e.visibility, e.vote_license, e.latitude, e.longitude,
  e.radius_meters, e.starts_at, e.ends_at, e.created_at,
  e.created_at::text AS created_at_cursor,
  EXISTS (SELECT 1 FROM event_invitations i
          WHERE i.event_id = e.id AND i.user_id = $1) AS is_invited`;

function toRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    visibility: row.visibility,
    license: eventLicenseFromColumns(row),
    createdAt: row.created_at,
    createdAtCursor: row.created_at_cursor,
    isInvited: row.is_invited,
  };
}

/** The license as the five database columns (all set for location_time, all null otherwise). */
function licenseColumns(license: AccessLicense) {
  if (license.type === "location_time") {
    return {
      vote_license: license.type,
      latitude: license.latitude,
      longitude: license.longitude,
      radius_meters: license.radiusMeters,
      starts_at: license.startsAt,
      ends_at: license.endsAt,
    };
  }
  return {
    vote_license: license.type,
    latitude: null,
    longitude: null,
    radius_meters: null,
    starts_at: null,
    ends_at: null,
  };
}

export async function insertEvent(
  db: Queryable,
  ownerId: string,
  values: EventValues,
): Promise<EventRecord> {
  const columns = licenseColumns(values.license);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO events (owner_id, name, visibility, vote_license, latitude, longitude,
                         radius_meters, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      ownerId,
      values.name,
      values.visibility,
      columns.vote_license,
      columns.latitude,
      columns.longitude,
      columns.radius_meters,
      columns.starts_at,
      columns.ends_at,
    ],
  );
  return (await findEvent(db, rows[0]!.id, ownerId))!;
}

/**
 * One event, with whether `userId` is invited. `lock` takes a row lock until
 * the transaction ends, so concurrent updates to one event run one after the other.
 */
export async function findEvent(
  db: Queryable,
  eventId: string,
  userId: string,
  options: { lock?: boolean } = {},
): Promise<EventRecord | null> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${EVENT_SELECT} FROM events e WHERE e.id = $2 ${options.lock ? "FOR UPDATE OF e" : ""}`,
    [userId, eventId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Events `userId` may see, newest first: public ones, their own, and private
 * ones they are invited to. This repeats the rule of access/rules.ts `canView`
 * in SQL, so a test checks the two agree (tests/integration/events.test.ts).
 * Returns up to `limit` rows; the caller asks for one extra to know if there is a next page.
 */
export async function listVisibleEvents(
  db: Queryable,
  userId: string,
  options: { limit: number; after?: ListCursor | undefined },
): Promise<EventRecord[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${EVENT_SELECT}
     FROM events e
     WHERE (e.visibility = 'public' OR e.owner_id = $1
            OR EXISTS (SELECT 1 FROM event_invitations i
                       WHERE i.event_id = e.id AND i.user_id = $1))
       AND ($2::timestamptz IS NULL OR (e.created_at, e.id) < ($2::timestamptz, $3::uuid))
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $4`,
    [userId, options.after?.createdAt ?? null, options.after?.id ?? null, options.limit],
  );
  return rows.map(toRecord);
}

export async function updateEvent(
  db: Queryable,
  eventId: string,
  values: EventValues,
): Promise<void> {
  const columns = licenseColumns(values.license);
  await db.query(
    `UPDATE events SET name = $2, visibility = $3, vote_license = $4, latitude = $5,
                       longitude = $6, radius_meters = $7, starts_at = $8, ends_at = $9
     WHERE id = $1`,
    [
      eventId,
      values.name,
      values.visibility,
      columns.vote_license,
      columns.latitude,
      columns.longitude,
      columns.radius_meters,
      columns.starts_at,
      columns.ends_at,
    ],
  );
}

export async function deleteEvent(db: Queryable, eventId: string): Promise<void> {
  await db.query("DELETE FROM events WHERE id = $1", [eventId]);
}
