import type { Friendship, Page } from "@music-room/shared";
import type pg from "pg";
import { foreignKeyViolationOf, uniqueViolationOf } from "../../db/pg-errors.js";
import { withTransaction } from "../../db/postgres.js";
import { HttpError } from "../../http-error.js";
import { decodeCursor, encodeCursor } from "../../list-cursor.js";
import {
  acceptPendingById,
  acceptRequest,
  deleteFriendship,
  deletePendingRequest,
  findById,
  findPairForUpdate,
  insertRequest,
  listFriends,
  listPendingRequests,
  userExists,
  viewOf,
  type FriendshipView,
} from "./repository.js";
import type { FriendRequestInput, ListQuery, RequestsQuery } from "./schema.js";

export interface FriendService {
  /** `created` is false when the request turned into a friendship because the other person had already asked. */
  sendRequest(
    userId: string,
    input: FriendRequestInput,
  ): Promise<{ friendship: Friendship; created: boolean }>;
  accept(userId: string, requestId: string): Promise<Friendship>;
  /** Declines (addressee) or cancels (requester) a pending request. */
  removeRequest(userId: string, requestId: string): Promise<void>;
  listRequests(userId: string, query: RequestsQuery): Promise<Page<Friendship>>;
  listFriends(userId: string, query: ListQuery): Promise<Page<Friendship>>;
  unfriend(userId: string, otherUserId: string): Promise<void>;
}

// Constraint names from the friendships migration.
const PAIR_KEY = "friendships_pair_key";
const REQUESTER_FK = "friendships_requester_id_fkey";
const ADDRESSEE_FK = "friendships_addressee_id_fkey";

// Two requests for one pair at the same moment: the loser of the insert retries and then finds
// the winner's row. More than a couple of rounds would mean something else is wrong.
const MAX_SEND_ATTEMPTS = 3;

const notFound = () =>
  new HttpError(404, "FRIENDSHIP_NOT_FOUND", "That friend request does not exist.");

function toApiFriendship(view: FriendshipView, userId: string): Friendship {
  return {
    id: view.id,
    user: { id: view.otherUserId, displayName: view.otherDisplayName },
    status: view.status,
    direction: view.requesterId === userId ? "outgoing" : "incoming",
    createdAt: view.createdAt.toISOString(),
    respondedAt: view.respondedAt?.toISOString() ?? null,
  };
}

function toPage(
  views: FriendshipView[],
  userId: string,
  limit: number,
): Page<Friendship> {
  const page = views.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((view) => toApiFriendship(view, userId)),
    nextCursor:
      views.length > limit && last
        ? encodeCursor({ createdAt: last.cursorTimestamp, id: last.id })
        : null,
  };
}

/** Business rules for friendships. No HTTP and no SQL in here. */
export function createFriendService(deps: { pool: pg.Pool }): FriendService {
  const { pool } = deps;

  async function requireView(id: string, userId: string): Promise<Friendship> {
    const view = await viewOf(pool, id, userId);
    // Gone since we wrote it: someone declined at the same moment.
    if (!view) throw notFound();
    return toApiFriendship(view, userId);
  }

  return {
    async sendRequest(userId, input) {
      if (input.userId === userId) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "You cannot send a friend request to yourself.",
        );
      }
      for (let attempt = 1; ; attempt++) {
        try {
          const outcome = await withTransaction(pool, async (client) => {
            if (!(await userExists(client, input.userId))) {
              throw new HttpError(404, "USER_NOT_FOUND", "That user does not exist.");
            }
            // Locks the pair's row if there is one, so the cases below cannot change underneath us.
            const existing = await findPairForUpdate(client, userId, input.userId);
            if (!existing) {
              const row = await insertRequest(client, userId, input.userId);
              return { id: row.id, created: true };
            }
            if (existing.status === "accepted") {
              throw new HttpError(409, "ALREADY_FRIENDS", "You are already friends.");
            }
            if (existing.requesterId === userId) {
              throw new HttpError(
                409,
                "FRIEND_REQUEST_EXISTS",
                "You have already sent this person a friend request.",
              );
            }
            // They asked first and now so did we: both want it, so it is accepted.
            await acceptPendingById(client, existing.id);
            return { id: existing.id, created: false };
          });
          return {
            friendship: await requireView(outcome.id, userId),
            created: outcome.created,
          };
        } catch (error) {
          if (uniqueViolationOf(error) === PAIR_KEY && attempt < MAX_SEND_ATTEMPTS) {
            continue; // the other direction was inserted first: decide again with its row in view
          }
          const fk = foreignKeyViolationOf(error);
          if (fk === REQUESTER_FK || fk === ADDRESSEE_FK) {
            // A user was deleted between our checks and the insert.
            throw new HttpError(404, "USER_NOT_FOUND", "That user does not exist.");
          }
          throw error;
        }
      }
    },

    async accept(userId, requestId) {
      // ONE statement decides: only the addressee of a pending request matches.
      const accepted = await acceptRequest(pool, requestId, userId);
      if (accepted) return requireView(accepted.id, userId);

      // Not accepted. Say why, without telling strangers that the request exists.
      const existing = await findById(pool, requestId);
      if (
        !existing ||
        (existing.requesterId !== userId && existing.addresseeId !== userId)
      ) {
        throw notFound();
      }
      if (existing.addresseeId !== userId) {
        throw new HttpError(
          403,
          "FORBIDDEN",
          "Only the person who received the request can accept it.",
        );
      }
      throw new HttpError(409, "ALREADY_FRIENDS", "You are already friends.");
    },

    async removeRequest(userId, requestId) {
      // Only a pending request the caller is part of: nobody else's, and never a friendship.
      if (!(await deletePendingRequest(pool, requestId, userId))) throw notFound();
    },

    async listRequests(userId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      const views = await listPendingRequests(pool, userId, query.direction, {
        limit: query.limit + 1,
        after,
      });
      return toPage(views, userId, query.limit);
    },

    async listFriends(userId, query) {
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      const views = await listFriends(pool, userId, { limit: query.limit + 1, after });
      return toPage(views, userId, query.limit);
    },

    async unfriend(userId, otherUserId) {
      if (!(await deleteFriendship(pool, userId, otherUserId))) {
        throw new HttpError(
          404,
          "FRIENDSHIP_NOT_FOUND",
          "You are not friends with that user.",
        );
      }
    },
  };
}
