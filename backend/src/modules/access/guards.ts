import { HttpError } from "../../http-error.js";
import {
  canView,
  decideAct,
  decideManage,
  type AccessResource,
  type AccessSubject,
  type ActContext,
  type Decision,
  type Refusal,
} from "./rules.js";

export type ResourceKind = "event" | "playlist";

const NOT_FOUND = {
  event: { code: "EVENT_NOT_FOUND", message: "Event not found." },
  playlist: { code: "PLAYLIST_NOT_FOUND", message: "Playlist not found." },
} as const;

/**
 * Turns a refusal into the HTTP error the contract promises. NOT_FOUND is
 * deliberately the same answer as for a resource that does not exist, so a
 * private resource cannot be discovered by guessing ids.
 */
export function toHttpError(kind: ResourceKind, refusal: Refusal): HttpError {
  switch (refusal) {
    case "NOT_FOUND":
      return new HttpError(404, NOT_FOUND[kind].code, NOT_FOUND[kind].message);
    case "FORBIDDEN":
      return new HttpError(403, "FORBIDDEN", "Only the owner can do this.");
    case "NOT_INVITED":
      return new HttpError(403, "NOT_INVITED", "You must be invited to do this.");
    case "LOCATION_REQUIRED":
      return new HttpError(
        400,
        "LOCATION_REQUIRED",
        "A precise location is required for this event.",
      );
    case "OUTSIDE_VOTING_AREA":
      return new HttpError(
        403,
        "OUTSIDE_VOTING_AREA",
        "You are outside the voting area.",
      );
    case "OUTSIDE_VOTING_TIME":
      return new HttpError(403, "OUTSIDE_VOTING_TIME", "Voting is not open right now.");
  }
}

function enforce(kind: ResourceKind, decision: Decision): void {
  if (!decision.allowed) throw toHttpError(kind, decision.refusal);
}

// What services call. Each throws the HttpError for a refusal and returns nothing
// on success. A service must call the right one BEFORE doing the work; being
// authenticated is not enough (CLAUDE.md: authentication does not imply authorization).

export function requireView(
  kind: ResourceKind,
  resource: AccessResource,
  subject: AccessSubject,
): void {
  if (!canView(resource, subject)) throw toHttpError(kind, "NOT_FOUND");
}

export function requireAct(
  kind: ResourceKind,
  resource: AccessResource,
  subject: AccessSubject,
  context: ActContext,
): void {
  enforce(kind, decideAct(resource, subject, context));
}

export function requireManage(
  kind: ResourceKind,
  resource: AccessResource,
  subject: AccessSubject,
): void {
  enforce(kind, decideManage(resource, subject));
}
