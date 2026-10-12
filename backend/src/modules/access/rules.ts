import type { MyPermissions, GeoPoint, Visibility } from "@music-room/shared";

// THE access rules (ADR-005), shared by Track Vote and Playlist Editor.
// Pure functions: no database, no clock, no HTTP. Everything they need is
// passed in, so every combination can be tested exhaustively. Loading the facts
// is repository.ts; turning a refusal into an HTTP error is guards.ts.
//
// Three questions are asked, in this order of strength:
//   view    - may this user know the resource exists?     (otherwise: 404)
//   act     - may this user vote/suggest/edit?            (otherwise: 403/400)
//   manage  - may this user change settings/invitations?  (owner only)
// The owner can always do all three.

/** The location + time rule of an event's `location_time` license. */
export interface LocationTimeRule {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  startsAt: Date;
  endsAt: Date;
}

export type AccessLicense =
  | { type: "everyone" }
  | { type: "invited_only" }
  | ({ type: "location_time" } & LocationTimeRule);

/** What the rules need to know about an event or a playlist. */
export interface AccessResource {
  ownerId: string;
  visibility: Visibility;
  license: AccessLicense;
}

/** The person asking, and the one fact about them that comes from the invitation list. */
export interface AccessSubject {
  userId: string;
  isInvited: boolean;
}

/** What the server knows about THIS request. `now` is the server clock, never the client's. */
export interface ActContext {
  now: Date;
  /** Where the user says they are; only read for the location_time license. */
  position?: GeoPoint | undefined;
}

export type Refusal =
  | "NOT_FOUND" // may not even know it exists (404)
  | "FORBIDDEN" // may see it but not manage it (403)
  | "NOT_INVITED" // may see it but the license is invited_only (403)
  | "LOCATION_REQUIRED" // location_time without a usable position (400)
  | "OUTSIDE_VOTING_AREA" // too far from the event (403)
  | "OUTSIDE_VOTING_TIME"; // before the start or at/after the end (403)

export type Decision = { allowed: true } | { allowed: false; refusal: Refusal };

const ALLOWED: Decision = { allowed: true };
const refuse = (refusal: Refusal): Decision => ({ allowed: false, refusal });

/** A position worse than this (or one that does not say) is not trusted for location_time. */
export const MAX_ACCURACY_METERS = 100;

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance in metres between two points (haversine formula). */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

const isOwner = (resource: AccessResource, subject: AccessSubject) =>
  resource.ownerId === subject.userId;

/** Public: everyone signed in. Private: the owner and invited users only. */
export function canView(resource: AccessResource, subject: AccessSubject): boolean {
  return (
    resource.visibility === "public" || isOwner(resource, subject) || subject.isInvited
  );
}

/** May the user change settings and invitations? Only the owner. */
export function decideManage(resource: AccessResource, subject: AccessSubject): Decision {
  if (!canView(resource, subject)) return refuse("NOT_FOUND");
  return isOwner(resource, subject) ? ALLOWED : refuse("FORBIDDEN");
}

function isUsablePosition(position: GeoPoint | undefined): position is GeoPoint {
  return (
    position !== undefined &&
    Number.isFinite(position.latitude) &&
    Math.abs(position.latitude) <= 90 &&
    Number.isFinite(position.longitude) &&
    Math.abs(position.longitude) <= 180 &&
    position.accuracyMeters !== undefined &&
    Number.isFinite(position.accuracyMeters) &&
    position.accuracyMeters >= 0 &&
    position.accuracyMeters <= MAX_ACCURACY_METERS
  );
}

function decideLocationTime(rule: LocationTimeRule, context: ActContext): Decision {
  // Time first: it needs nothing from the client, and the server clock decides.
  // The window is [startsAt, endsAt): voting opens at the start instant and
  // closes at the end instant, so two back-to-back windows never overlap.
  const now = context.now.getTime();
  if (now < rule.startsAt.getTime() || now >= rule.endsAt.getTime()) {
    return refuse("OUTSIDE_VOTING_TIME");
  }
  // The server computes the distance itself; the client only reports coordinates.
  if (!isUsablePosition(context.position)) return refuse("LOCATION_REQUIRED");
  return distanceMeters(context.position, rule) <= rule.radiusMeters
    ? ALLOWED
    : refuse("OUTSIDE_VOTING_AREA");
}

/**
 * May the user vote/suggest (event) or edit (playlist) right now?
 * The license applies to people who can already see the resource. The owner
 * always may. Anything not listed here is refused (fail closed).
 */
export function decideAct(
  resource: AccessResource,
  subject: AccessSubject,
  context: ActContext,
): Decision {
  if (!canView(resource, subject)) return refuse("NOT_FOUND");
  if (isOwner(resource, subject)) return ALLOWED;

  const license = resource.license;
  switch (license.type) {
    case "everyone":
      return ALLOWED;
    case "invited_only":
      return subject.isInvited ? ALLOWED : refuse("NOT_INVITED");
    case "location_time":
      return decideLocationTime(license, context);
    default: {
      const unknown: never = license;
      throw new Error(`Unknown license: ${JSON.stringify(unknown)}`);
    }
  }
}

/**
 * The `myPermissions` shown to the app. A UI HINT ONLY: the backend runs
 * decideAct/decideManage again on every request. For location_time, `canAct`
 * means "eligible if you are in the right place and time".
 */
export function permissionsOf(
  resource: AccessResource,
  subject: AccessSubject,
): MyPermissions {
  const view = canView(resource, subject);
  const owner = isOwner(resource, subject);
  let canAct = false;
  if (view) {
    canAct =
      owner ||
      resource.license.type === "everyone" ||
      resource.license.type === "location_time" ||
      subject.isInvited;
  }
  return { canView: view, canAct, canManage: view && owner };
}
