import type { Page, UserSummary } from "@music-room/shared";
import type pg from "pg";
import { decodeUserCursor, encodeUserCursor } from "./cursor.js";
import { searchUsersByDisplayNamePrefix } from "./repository.js";
import type { SearchQuery } from "./schema.js";

export interface UserService {
  search(callerId: string, query: SearchQuery): Promise<Page<UserSummary>>;
}

export function createUserService(deps: { pool: pg.Pool }): UserService {
  return {
    async search(callerId, query) {
      const after = query.cursor ? decodeUserCursor(query.cursor) : undefined;
      const rows = await searchUsersByDisplayNamePrefix(
        deps.pool,
        callerId,
        query.query,
        {
          limit: query.limit + 1,
          after,
        },
      );
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        // Exactly UserSummary: never an email or linked providers.
        items: page.map((row) => ({ id: row.id, displayName: row.displayName })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeUserCursor({ name: last.sortKey, id: last.id })
            : null,
      };
    },
  };
}
