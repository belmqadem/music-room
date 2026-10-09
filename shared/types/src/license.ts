// API contract: licenses and permissions. Owner: belmqadem (Core & Infra).
// Changes need review from BOTH developers. See docs/api-contract.md ("Access rules") and ADR-005.

/** A circle on the map plus a time window, both required (Track Vote only). */
export interface LocationTimeRule {
  latitude: number; // degrees, -90..90
  longitude: number; // degrees, -180..180
  radiusMeters: number;
  startsAt: string; // ISO 8601 UTC, must be before endsAt
  endsAt: string; // ISO 8601 UTC
}

/** Who may vote or suggest in an event. Default: everyone. */
export type VoteLicense =
  | { type: "everyone" }
  | { type: "invited_only" }
  | ({ type: "location_time" } & LocationTimeRule);

/** Who may edit a playlist. Default: everyone. */
export type EditLicense = { type: "everyone" } | { type: "invited_only" };

/**
 * What the current user may do on a resource. A UI HINT ONLY: the backend
 * re-checks on every request, so the app must never treat this as the
 * authority. For a location_time event, canAct means "eligible if you are in
 * the right place and time"; the real check needs your location.
 */
export interface MyPermissions {
  canView: boolean;
  canAct: boolean; // vote/suggest (event) or edit (playlist)
  canManage: boolean; // owner: settings and invitations
}

/** Position sent with a vote/suggestion when the license is location_time. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}
