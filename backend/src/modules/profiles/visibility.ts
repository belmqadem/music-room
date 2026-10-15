import type { Profile } from "@music-room/shared";

// SECURITY: this file is the ONLY place that decides who sees which part of a profile (ADR-024).
// Both endpoints build their answer with `shapeProfile`, so there is no second code path that
// could forget a check.

/** How the caller relates to the profile's owner. */
export type Relation = "self" | "friend" | "stranger";

/** What the database holds for one user (blocks the owner never filled in are null / empty). */
export interface ProfileRecord {
  userId: string;
  displayName: string;
  bio: string | null;
  fullName: string | null;
  city: string | null;
  phone: string | null;
  birthDate: string | null;
  genres: string[];
}

/**
 * Public block for everyone; friends block and music preferences for friends and the owner;
 * private block for the owner only. A block the caller may not see is left out entirely.
 */
export function shapeProfile(record: ProfileRecord, relation: Relation): Profile {
  const profile: Profile = {
    userId: record.userId,
    displayName: record.displayName,
    publicInfo: { bio: record.bio },
  };
  if (relation === "self" || relation === "friend") {
    profile.friendsInfo = { fullName: record.fullName, city: record.city };
    profile.musicPreferences = { genres: record.genres };
  }
  if (relation === "self") {
    profile.privateInfo = { phone: record.phone, birthDate: record.birthDate };
  }
  return profile;
}
