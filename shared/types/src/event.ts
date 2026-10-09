// API contract: Event (Track Vote). Owner: belmqadem. Changes need review from BOTH developers.
// See docs/api-contract.md ("Events") and ADR-005.
import type { VoteLicense, MyPermissions } from "./license";
import type { Visibility } from "./visibility";

export interface MusicEvent {
  id: string; // UUID
  name: string;
  ownerId: string; // User id
  visibility: Visibility;
  voteLicense: VoteLicense;
  createdAt: string; // ISO 8601 UTC
  myPermissions: MyPermissions;
}

export interface CreateEventRequest {
  name: string;
  visibility?: Visibility; // default "public"
  voteLicense?: VoteLicense; // default { type: "everyone" }
}

/** All fields optional; at least one must be present. */
export interface UpdateEventRequest {
  name?: string;
  visibility?: Visibility;
  voteLicense?: VoteLicense;
}
