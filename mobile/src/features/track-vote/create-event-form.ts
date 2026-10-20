import type { CreateEventRequest, Visibility, VoteLicense } from "@music-room/shared";

// The create-event form (docs/api-contract.md, "Events" and "Access rules"): what the screen holds,
// and the request it becomes. The checks mirror the backend's (track-vote/schema.ts) so the user
// gets an answer before the network; a test proves both agree. The backend still decides.

export type VoteMode = VoteLicense["type"];

export const NAME_MAX_LENGTH = 100;
/** Choices instead of a free number: wide enough for a room or a park, never "the whole city". */
export const RADIUS_CHOICES_M = [100, 200, 500, 1000] as const;
/** Presets instead of a date picker (which would be a new native dependency). */
export const START_CHOICES_MIN = [0, 60, 120] as const;
export const DURATION_CHOICES_H = [1, 2, 4, 8] as const;

export interface CreateEventDraft {
  name: string;
  visibility: Visibility;
  mode: VoteMode;
  /** As typed (or filled from the phone's position), so a half-typed number can be edited. */
  latitude: string;
  longitude: string;
  radiusMeters: (typeof RADIUS_CHOICES_M)[number];
  startsInMinutes: (typeof START_CHOICES_MIN)[number];
  durationHours: (typeof DURATION_CHOICES_H)[number];
}

export const EMPTY_DRAFT: CreateEventDraft = {
  name: "",
  visibility: "public",
  mode: "everyone",
  latitude: "",
  longitude: "",
  radiusMeters: 200,
  startsInMinutes: 0,
  durationHours: 4,
};

export type DraftField = "name" | "latitude" | "longitude";

export type DraftResult =
  | { ok: true; request: CreateEventRequest }
  | { ok: false; errors: Partial<Record<DraftField, string>> };

export const DRAFT_MESSAGES = {
  nameMissing: "Give the event a name.",
  nameTooLong: `Keep the name under ${NAME_MAX_LENGTH + 1} characters.`,
  latitude: "Enter a latitude between -90 and 90 (or use your position).",
  longitude: "Enter a longitude between -180 and 180 (or use your position).",
} as const;

/** "48.89" or "48,89" (a comma keyboard); anything else, or out of range, is null. */
export function coordinateFrom(text: string, limit: number): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Math.abs(value) <= limit ? value : null;
}

/** The request for POST /events, or the fields to fix. `now` is passed so tests are exact. */
export function createEventRequestFrom(draft: CreateEventDraft, now: Date): DraftResult {
  const errors: Partial<Record<DraftField, string>> = {};
  const name = draft.name.trim();
  if (name.length === 0) errors.name = DRAFT_MESSAGES.nameMissing;
  else if (name.length > NAME_MAX_LENGTH) errors.name = DRAFT_MESSAGES.nameTooLong;

  let voteLicense: VoteLicense = { type: draft.mode } as VoteLicense;
  if (draft.mode === "location_time") {
    const latitude = coordinateFrom(draft.latitude, 90);
    const longitude = coordinateFrom(draft.longitude, 180);
    if (latitude === null) errors.latitude = DRAFT_MESSAGES.latitude;
    if (longitude === null) errors.longitude = DRAFT_MESSAGES.longitude;
    const starts = new Date(now.getTime() + draft.startsInMinutes * 60_000);
    const ends = new Date(starts.getTime() + draft.durationHours * 3_600_000);
    voteLicense = {
      type: "location_time",
      latitude: latitude ?? 0,
      longitude: longitude ?? 0,
      radiusMeters: draft.radiusMeters,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
    };
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { name, visibility: draft.visibility, voteLicense } };
}
