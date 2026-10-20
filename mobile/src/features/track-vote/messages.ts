import type { EventQueueUpdate, EventTrack } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { MESSAGES } from "@/auth/forms/error-messages";
import { isPositionUnavailable, type PositionProblem } from "@/location/position-error";

// What to tell the user when a Track Vote call fails, from the error's stable `code` (never the
// server's message as is). Codes: docs/api-contract.md, "Access rules" and "Events".

export const TRACK_VOTE_MESSAGES = {
  notFound: "This event no longer exists, or you can no longer see it.",
  notInvited: "Only invited people can vote in this event.",
  // The server says this after a position was sent: it was not precise enough (worse than 100 m).
  imprecisePosition:
    "Your position isn't precise enough to vote here. Turn on precise location, then try again.",
  outsideArea: "You are too far from the event to vote.",
  outsideTime: "Voting is closed: the event is not running right now.",
  notVotable: "This track is already playing or has been played.",
  queueChanged: "The queue moved on another device first. Here is the current one.",
  ownerOnly: "Only the event's owner can do that.",
  alreadyQueued: "That track is already in the queue: your vote was added to it.",
  catalogMissing: "The catalog no longer has this track.",
  catalogDown: "The music catalog can't be reached right now. Try again in a moment.",
  unknown: "Something went wrong. Try again.",
} as const;

export const POSITION_MESSAGES: Record<PositionProblem, string> = {
  services_off:
    "Turn on location services to vote in this event: it takes votes at its venue.",
  denied:
    "This event takes votes at its venue: allow Music Room to use your location to vote.",
  blocked:
    "Location is turned off for Music Room. Turn it on in Settings to vote in this event.",
  timeout: "Couldn't find your position. Try again.",
};

export function trackVoteErrorMessage(error: unknown): string {
  if (isPositionUnavailable(error)) return POSITION_MESSAGES[error.problem];
  if (!isRequestError(error)) return TRACK_VOTE_MESSAGES.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    case "EVENT_NOT_FOUND":
    case "NOT_FOUND":
      return TRACK_VOTE_MESSAGES.notFound;
    case "NOT_INVITED":
      return TRACK_VOTE_MESSAGES.notInvited;
    case "LOCATION_REQUIRED":
      return TRACK_VOTE_MESSAGES.imprecisePosition;
    case "OUTSIDE_VOTING_AREA":
      return TRACK_VOTE_MESSAGES.outsideArea;
    case "OUTSIDE_VOTING_TIME":
      return TRACK_VOTE_MESSAGES.outsideTime;
    case "TRACK_NOT_VOTABLE":
      return TRACK_VOTE_MESSAGES.notVotable;
    case "QUEUE_CHANGED":
      return TRACK_VOTE_MESSAGES.queueChanged;
    case "FORBIDDEN":
      return TRACK_VOTE_MESSAGES.ownerOnly;
    case "TRACK_NOT_FOUND":
      return TRACK_VOTE_MESSAGES.catalogMissing;
    case "PROVIDER_UNAVAILABLE":
      return TRACK_VOTE_MESSAGES.catalogDown;
    default:
      return error.status >= 500 ? MESSAGES.server : TRACK_VOTE_MESSAGES.unknown;
  }
}

/** A 409 QUEUE_CHANGED carries the real current queue in `details`: show that instead. */
export function currentQueueFrom(error: unknown): EventQueueUpdate | null {
  if (!isRequestError(error) || error.code !== "QUEUE_CHANGED") return null;
  const details = error.details as Partial<EventQueueUpdate> | null;
  return details && typeof details.version === "number" && Array.isArray(details.tracks)
    ? (details as EventQueueUpdate)
    : null;
}

/** A 409 TRACK_ALREADY_QUEUED carries the track already in the queue: the app can vote for it. */
export function queuedTrackFrom(error: unknown): EventTrack | null {
  if (!isRequestError(error) || error.code !== "TRACK_ALREADY_QUEUED") return null;
  const details = error.details as Partial<EventTrack> | null;
  return details && typeof details.id === "string" && typeof details.eventId === "string"
    ? (details as EventTrack)
    : null;
}
