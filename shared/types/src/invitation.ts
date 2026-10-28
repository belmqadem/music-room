// API contract: invitations (shared by events and playlists). Owner: belmqadem (Core & Infra).
// Changes need review from BOTH developers. See docs/api-contract.md ("Access rules").
import type { UserSummary } from "./user";

export interface Invitation {
  resourceId: string; // event or playlist id
  user: UserSummary; // never the full User: the owner must not see an invitee's email
  invitedAt: string; // ISO 8601 UTC
}

export interface InviteRequest {
  userId: string;
}
