import type { Profile, UpdateProfileRequest } from "@music-room/shared";
import { copy } from "@/copy";

// The edit-profile form (docs/api-contract.md, "Profiles"; ADR-024). The checks mirror the
// backend's (profiles/schema.ts) so the user gets an answer before the network; a test runs every
// request this builds through the backend's own schema. The server still decides.

export const BIO_MAX_LENGTH = 280;
export const NAME_MAX_LENGTH = 80; // full name and city
export const MAX_GENRES = 10;
export const GENRE_MAX_LENGTH = 30;
const MIN_BIRTH_YEAR = 1900;

const PHONE_SHAPE = /^\+?[0-9 ().-]{3,30}$/;
const GENRE_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} &'+\-/.]*$/u;

/** What the form holds: plain text, as typed. Genres are one comma-separated field. */
export interface ProfileDraft {
  bio: string;
  fullName: string;
  city: string;
  phone: string;
  birthDate: string;
  genres: string;
}

export type ProfileField = keyof ProfileDraft;

export type ProfileDraftResult =
  | { ok: true; request: UpdateProfileRequest }
  | { ok: false; errors: Partial<Record<ProfileField, string>> };

/** The form, filled from the profile as the server has it. */
export function draftFromProfile(profile: Profile): ProfileDraft {
  return {
    bio: profile.publicInfo.bio ?? "",
    fullName: profile.friendsInfo?.fullName ?? "",
    city: profile.friendsInfo?.city ?? "",
    phone: profile.privateInfo?.phone ?? "",
    birthDate: profile.privateInfo?.birthDate ?? "",
    genres: (profile.musicPreferences?.genres ?? []).join(", "),
  };
}

/** "Rock, jazz,, ROCK " -> ["rock", "jazz"]: trimmed, lowercased, no blanks, no duplicates. */
export function genresFrom(text: string): string[] {
  const tags = text
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  return [...new Set(tags)];
}

/** A real calendar date, written YYYY-MM-DD (2023-02-30 is not one). */
function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function birthDateError(value: string, today: string): string | null {
  const errors = copy.editProfile.errors;
  if (!isRealDate(value)) return errors.birthDateShape;
  if (Number(value.slice(0, 4)) < MIN_BIRTH_YEAR) return errors.birthDateTooOld;
  if (value > today) return errors.birthDateFuture;
  return null;
}

function genresError(tags: string[]): string | null {
  const errors = copy.editProfile.errors;
  if (tags.length > MAX_GENRES) return errors.tooManyGenres(MAX_GENRES);
  if (tags.some((tag) => tag.length > GENRE_MAX_LENGTH)) {
    return errors.genreTooLong(GENRE_MAX_LENGTH);
  }
  if (tags.some((tag) => !GENRE_SHAPE.test(tag))) return errors.genreShape;
  return null;
}

/** Trimmed; blank becomes null, which clears the field on the server. */
const valueOf = (text: string): string | null =>
  text.trim() === "" ? null : text.trim();

/**
 * The PATCH body with only what changed since `original`, or the fields to fix. An unchanged form
 * gives an empty body: nothing to send. `today` is "YYYY-MM-DD" in UTC, as the server compares.
 */
export function profileUpdateFrom(
  draft: ProfileDraft,
  original: ProfileDraft,
  today: string,
): ProfileDraftResult {
  const errors: Partial<Record<ProfileField, string>> = {};
  const tooLong = copy.editProfile.errors.tooLong;
  const bio = valueOf(draft.bio);
  const fullName = valueOf(draft.fullName);
  const city = valueOf(draft.city);
  const phone = valueOf(draft.phone);
  const birthDate = valueOf(draft.birthDate);
  const genres = genresFrom(draft.genres);

  if (bio !== null && bio.length > BIO_MAX_LENGTH) errors.bio = tooLong(BIO_MAX_LENGTH);
  if (fullName !== null && fullName.length > NAME_MAX_LENGTH) {
    errors.fullName = tooLong(NAME_MAX_LENGTH);
  }
  if (city !== null && city.length > NAME_MAX_LENGTH)
    errors.city = tooLong(NAME_MAX_LENGTH);
  if (phone !== null && !PHONE_SHAPE.test(phone))
    errors.phone = copy.editProfile.errors.phone;
  const dateProblem = birthDate === null ? null : birthDateError(birthDate, today);
  if (dateProblem) errors.birthDate = dateProblem;
  const genresProblem = genresError(genres);
  if (genresProblem) errors.genres = genresProblem;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const changed = (field: Exclude<ProfileField, "genres">, value: string | null) =>
    value !== valueOf(original[field]);
  const request: UpdateProfileRequest = {};
  if (changed("bio", bio)) request.publicInfo = { bio };
  if (changed("fullName", fullName) || changed("city", city)) {
    request.friendsInfo = {
      ...(changed("fullName", fullName) && { fullName }),
      ...(changed("city", city) && { city }),
    };
  }
  if (changed("phone", phone) || changed("birthDate", birthDate)) {
    request.privateInfo = {
      ...(changed("phone", phone) && { phone }),
      ...(changed("birthDate", birthDate) && { birthDate }),
    };
  }
  if (genres.join(",") !== genresFrom(original.genres).join(",")) {
    request.musicPreferences = { genres };
  }
  return { ok: true, request };
}

/** "YYYY-MM-DD" today in UTC: the server's own day for the birth-date check. */
export const todayUtc = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);
