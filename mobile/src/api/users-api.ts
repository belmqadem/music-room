import type { Page, UserSummary } from "@music-room/shared";
import { auth } from "@/auth";

// Finding people to invite (docs/api-contract.md, "Finding users", ADR-013): a prefix match on the
// display name. Only `{ id, displayName }` comes back, never an email; display names are not
// unique, so people are invited by id.
export const usersApi = {
  search: (query: string) =>
    auth.request<Page<UserSummary>>("GET", "/users", { query: { query, limit: 20 } }),
};
