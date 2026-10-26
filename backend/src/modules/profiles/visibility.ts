import type { Profile, ProfileFriendship } from "@music-room/shared";
import type { FriendshipRecord } from "../friends/repository.js";

// SECURITY: this file is the ONLY place that decides who sees which part of a profile (ADR-024).
// Both endpoints build their answer with `shapeProfile`, so there is no second code path that
// could forget a check.

/** How the caller relates to the profile's owner. */
export type Relation = "self" | "friend" | "stranger";

/**
 * From the request or friendship between the two (null if none). Only an ACCEPTED friendship makes
 * a friend: a pending request, in either direction, does not.
 */
export function relationOf(
  callerId: string,
  ownerId: string,
  pair: FriendshipRecord | null,
): Relation {
  if (callerId === ownerId) return "self";
  return pair?.status === "accepted" ? "friend" : "stranger";
}

/**
 * Where the caller stands with the owner, from the caller's side (ADR-042). The two of them are
 * the only people this row concerns, so telling the caller about it reveals nothing to anyone else.
 */
export function friendshipOf(
  callerId: string,
  pair: FriendshipRecord | null,
): ProfileFriendship | null {
  if (!pair) return null;
  return {
    id: pair.id,
    status: pair.status,
    direction: pair.requesterId === callerId ? "outgoing" : "incoming",
  };
}

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
export function shapeProfile(
  record: ProfileRecord,
  relation: Relation,
  friendship: ProfileFriendship | null,
): Profile {
  const profile: Profile = {
    userId: record.userId,
    displayName: record.displayName,
    publicInfo: { bio: record.bio },
    friendship: relation === "self" ? null : friendship,
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
