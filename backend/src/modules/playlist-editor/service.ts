import type { Invitation, Page, Playlist } from "@music-room/shared";
import type pg from "pg";
import { foreignKeyViolationOf, uniqueViolationOf } from "../../db/pg-errors.js";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { noRealtime, type RealtimeEvents } from "../../realtime-events.js";
import { decodeCursor, encodeCursor } from "../../list-cursor.js";
import { requireManage, requireView, toHttpError } from "../access/guards.js";
import { permissionsOf, type AccessLicense } from "../access/rules.js";
import {
  accessOf,
  deleteInvitation,
  deletePlaylist,
  findPlaylist,
  insertInvitation,
  insertPlaylist,
  listInvitations,
  listVisiblePlaylists,
  updatePlaylist,
  type InvitationRecord,
  type PlaylistRecord,
} from "./repository.js";
import type {
  CreatePlaylistInput,
  InviteInput,
  ListQuery,
  UpdatePlaylistInput,
} from "./schema.js";

export interface PlaylistService {
  create(userId: string, input: CreatePlaylistInput): Promise<Playlist>;
  list(userId: string, query: ListQuery): Promise<Page<Playlist>>;
  get(userId: string, playlistId: string): Promise<Playlist>;
  update(
    userId: string,
    playlistId: string,
    input: UpdatePlaylistInput,
  ): Promise<Playlist>;
  remove(userId: string, playlistId: string): Promise<void>;
  listInvitations(
    userId: string,
    playlistId: string,
    query: ListQuery,
  ): Promise<Page<Invitation>>;
  invite(userId: string, playlistId: string, input: InviteInput): Promise<Invitation>;
  removeInvitation(
    userId: string,
    playlistId: string,
    invitedUserId: string,
  ): Promise<void>;
}

// Constraint names from the playlist_invitations migration.
const INVITATION_PRIMARY_KEY = "playlist_invitations_pkey";
const INVITATION_PLAYLIST_FK = "playlist_invitations_playlist_id_fkey";
const INVITATION_USER_FK = "playlist_invitations_user_id_fkey";

/** The playlist as the app sees it. `myPermissions` is a hint; every call re-checks the rules. */
function toApiPlaylist(record: PlaylistRecord, userId: string): Playlist {
  return {
    id: record.id,
    name: record.name,
    ownerId: record.ownerId,
    visibility: record.visibility,
    // Playlists only have the two simple licenses; the guard keeps a bad row from leaking out.
    editLicense: toApiLicense(record.license),
    createdAt: record.createdAt.toISOString(),
    myPermissions: permissionsOf(
      { ownerId: record.ownerId, visibility: record.visibility, license: record.license },
      { userId, isInvited: record.isInvited },
    ),
  };
}

function toApiLicense(license: AccessLicense): Playlist["editLicense"] {
  if (license.type === "everyone" || license.type === "invited_only")
    return { type: license.type };
  throw new Error(`Unexpected playlist license: ${license.type}`);
}

const toApiInvitation = (record: InvitationRecord): Invitation => ({
  resourceId: record.playlistId,
  // Only id and display name: the owner must not see an invitee's email.
  user: { id: record.userId, displayName: record.displayName },
  invitedAt: record.invitedAt.toISOString(),
});

/** Business rules for playlists. Every method checks authorization BEFORE doing the work. */
export function createPlaylistService(deps: {
  pool: pg.Pool;
  /** Told about changes of who may see a playlist, after they are committed. */
  events?: RealtimeEvents;
}): PlaylistService {
  const { pool } = deps;
  const events = deps.events ?? noRealtime;

  return {
    async create(userId, input) {
      const record = await insertPlaylist(pool, userId, {
        name: input.name,
        visibility: input.visibility ?? "public",
        license: input.editLicense ?? { type: "everyone" },
      });
      return toApiPlaylist(record, userId);
    },

    async list(userId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      // One extra row tells us whether another page exists.
      const rows = await listVisiblePlaylists(pool, userId, {
        limit: query.limit + 1,
        after,
      });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((record) => toApiPlaylist(record, userId)),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: last.createdAtCursor, id: last.id })
            : null,
      };
    },

    async get(userId, playlistId) {
      const record = await findPlaylist(pool, playlistId, userId);
      if (!record) throw toHttpError("playlist", "NOT_FOUND");
      const { resource, subject } = accessOf(record, userId);
      requireView("playlist", resource, subject);
      return toApiPlaylist(record, userId);
    },

    async update(userId, playlistId, input) {
      let visibilityChanged = false;
      const result = await withTransaction(pool, async (client) => {
        visibilityChanged = false; // the work may run again after a deadlock retry
        // Lock the row: two simultaneous PATCHes (one changing the name, one the
        // visibility) run one after the other, so neither overwrites the other.
        const current = await findPlaylist(client, playlistId, userId, {
          lock: "update",
        });
        if (!current) throw toHttpError("playlist", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("playlist", resource, subject);

        await updatePlaylist(client, playlistId, {
          name: input.name ?? current.name,
          visibility: input.visibility ?? current.visibility,
          license: input.editLicense ?? current.license,
        });
        const updated = await findPlaylist(client, playlistId, userId);
        if (!updated)
          throw new HttpError(500, "INTERNAL_ERROR", "Playlist vanished during update.");
        visibilityChanged = updated.visibility !== current.visibility;
        return toApiPlaylist(updated, userId);
      });
      // Only a change of visibility changes who may SEE the playlist (the license does not).
      if (visibilityChanged) events.playlistAccessChanged(playlistId);
      return result;
    },

    async remove(userId, playlistId) {
      await withTransaction(pool, async (client) => {
        const current = await findPlaylist(client, playlistId, userId, {
          lock: "update",
        });
        if (!current) throw toHttpError("playlist", "NOT_FOUND");
        const { resource, subject } = accessOf(current, userId);
        requireManage("playlist", resource, subject);
        await deletePlaylist(client, playlistId);
      });
      events.playlistDeleted(playlistId);
    },

    async listInvitations(userId, playlistId, query) {
      const current = await findPlaylist(pool, playlistId, userId);
      if (!current) throw toHttpError("playlist", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("playlist", resource, subject); // only the owner sees who is invited

      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await listInvitations(pool, playlistId, {
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

    async invite(userId, playlistId, input) {
      const current = await findPlaylist(pool, playlistId, userId);
      if (!current) throw toHttpError("playlist", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("playlist", resource, subject);

      if (input.userId === current.ownerId) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "The owner is always allowed; no invitation needed.",
        );
      }
      try {
        return toApiInvitation(await insertInvitation(pool, playlistId, input.userId));
      } catch (error) {
        // The database decides, so two simultaneous invites cannot both succeed.
        if (uniqueViolationOf(error) === INVITATION_PRIMARY_KEY) {
          throw new HttpError(409, "ALREADY_INVITED", "This user is already invited.");
        }
        const foreignKey = foreignKeyViolationOf(error);
        if (foreignKey === INVITATION_USER_FK) {
          throw new HttpError(404, "NOT_FOUND", "User not found.");
        }
        // The playlist was deleted between our check and the insert.
        if (foreignKey === INVITATION_PLAYLIST_FK)
          throw toHttpError("playlist", "NOT_FOUND");
        throw error;
      }
    },

    async removeInvitation(userId, playlistId, invitedUserId) {
      const current = await findPlaylist(pool, playlistId, userId);
      if (!current) throw toHttpError("playlist", "NOT_FOUND");
      const { resource, subject } = accessOf(current, userId);
      requireManage("playlist", resource, subject);
      // Idempotent: removing an invitation that is already gone is not an error.
      await deleteInvitation(pool, playlistId, invitedUserId);
      // A private playlist stops being visible to that user: close their live channel too.
      events.playlistAccessChanged(playlistId);
    },
  };
}
