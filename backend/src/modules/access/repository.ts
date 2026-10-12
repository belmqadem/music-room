import type pg from "pg";
import type { AccessLicense, AccessResource, AccessSubject } from "./rules.js";

// Loads the facts the access rules need, in ONE query per resource (the
// resource plus "is this user on its invitation list?"), so the rules never
// see a half-loaded picture.
type Queryable = Pick<pg.Pool, "query">;

export interface LoadedAccess {
  id: string;
  resource: AccessResource;
  subject: AccessSubject;
}

interface EventAccessRow {
  id: string;
  owner_id: string;
  visibility: "public" | "private";
  vote_license: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
  is_invited: boolean;
}

interface PlaylistAccessRow {
  id: string;
  owner_id: string;
  visibility: "public" | "private";
  edit_license: string;
  is_invited: boolean;
}

/**
 * Builds the license from its columns. The database guarantees consistency
 * (see events_location_time_complete), but if a row ever disagrees we THROW
 * instead of guessing: an unreadable license must not turn into an open one.
 */
export function eventLicenseFromColumns(row: {
  vote_license: string;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  starts_at: Date | null;
  ends_at: Date | null;
}): AccessLicense {
  switch (row.vote_license) {
    case "everyone":
    case "invited_only":
      return { type: row.vote_license };
    case "location_time":
      if (
        row.latitude === null ||
        row.longitude === null ||
        row.radius_meters === null ||
        row.starts_at === null ||
        row.ends_at === null
      ) {
        throw new Error("location_time license with missing location fields");
      }
      return {
        type: "location_time",
        latitude: row.latitude,
        longitude: row.longitude,
        radiusMeters: row.radius_meters,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
      };
    default:
      throw new Error(`Unknown vote license: ${row.vote_license}`);
  }
}

export function playlistLicenseFromColumn(editLicense: string): AccessLicense {
  if (editLicense === "everyone" || editLicense === "invited_only") {
    return { type: editLicense };
  }
  throw new Error(`Unknown edit license: ${editLicense}`);
}

/** Returns null when the event does not exist. NOT whether the user may see it: ask the rules. */
export async function loadEventAccess(
  db: Queryable,
  eventId: string,
  userId: string,
): Promise<LoadedAccess | null> {
  const { rows } = await db.query<EventAccessRow>(
    `SELECT e.id, e.owner_id, e.visibility, e.vote_license, e.latitude, e.longitude,
            e.radius_meters, e.starts_at, e.ends_at,
            EXISTS (SELECT 1 FROM event_invitations i
                    WHERE i.event_id = e.id AND i.user_id = $2) AS is_invited
     FROM events e WHERE e.id = $1`,
    [eventId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    resource: {
      ownerId: row.owner_id,
      visibility: row.visibility,
      license: eventLicenseFromColumns(row),
    },
    subject: { userId, isInvited: row.is_invited },
  };
}

/** Returns null when the playlist does not exist. */
export async function loadPlaylistAccess(
  db: Queryable,
  playlistId: string,
  userId: string,
): Promise<LoadedAccess | null> {
  const { rows } = await db.query<PlaylistAccessRow>(
    `SELECT p.id, p.owner_id, p.visibility, p.edit_license,
            EXISTS (SELECT 1 FROM playlist_invitations i
                    WHERE i.playlist_id = p.id AND i.user_id = $2) AS is_invited
     FROM playlists p WHERE p.id = $1`,
    [playlistId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    resource: {
      ownerId: row.owner_id,
      visibility: row.visibility,
      license: playlistLicenseFromColumn(row.edit_license),
    },
    subject: { userId, isInvited: row.is_invited },
  };
}
