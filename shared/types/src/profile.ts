// API contract: profile. Owner: belmqadem (Core & Infra). Changes need review from BOTH developers.
// See docs/api-contract.md ("Profiles") and ADR-024.

/** Visible to any signed-in user. */
export interface PublicInfo {
  bio: string | null; // ≤ 280 characters
}

/** Visible to accepted friends and the owner. */
export interface FriendsInfo {
  fullName: string | null; // ≤ 80
  city: string | null; // ≤ 80
}

/** Visible to the owner only: never returned when someone else asks. */
export interface PrivateInfo {
  phone: string | null; // ≤ 30
  birthDate: string | null; // YYYY-MM-DD
}

/** Visible to accepted friends and the owner. */
export interface MusicPreferences {
  genres: string[]; // ≤ 10 tags, each ≤ 30 characters, lowercase, no duplicates
}

/**
 * A profile as the CALLER may see it. A block the caller may not see is OMITTED (not empty, not
 * null), so a missing block never reveals whether the user filled it in.
 * Owner: all four blocks. Accepted friend: publicInfo, friendsInfo, musicPreferences.
 * Anyone else signed in: publicInfo only.
 */
export interface Profile {
  userId: string; // UUID
  displayName: string;
  publicInfo: PublicInfo;
  friendsInfo?: FriendsInfo;
  musicPreferences?: MusicPreferences;
  privateInfo?: PrivateInfo;
}

/**
 * Body of PATCH /users/me/profile. Every block and every field is optional: what is absent is
 * left as it is, `null` clears a field. `genres`, when sent, replaces the whole list.
 */
export interface UpdateProfileRequest {
  publicInfo?: { bio?: string | null };
  friendsInfo?: { fullName?: string | null; city?: string | null };
  privateInfo?: { phone?: string | null; birthDate?: string | null };
  musicPreferences?: { genres?: string[] };
}
