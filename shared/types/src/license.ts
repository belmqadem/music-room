// API contract: roles and licenses. Owner: belmqadem (Core & Infra).
// Changes need review from BOTH developers. See docs/api-contract.md ("Access rules") and ADR-004.

export type Role = "owner" | "editor" | "voter" | "listener";

/**
 * What the current user may do in a room. Computed by the backend from role and
 * room flags; the app uses it only to show/hide UI. The backend re-checks on
 * every request, so the app must never treat this as the authority.
 */
export interface License {
  canVote: boolean;
  canEdit: boolean;
  canControlPlayback: boolean;
}
