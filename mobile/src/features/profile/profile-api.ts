import type { Profile, UpdateProfileRequest } from "@music-room/shared";
import { auth } from "@/auth";

// The profile endpoints (docs/api-contract.md, "Profiles"; ADR-024). The server decides which
// blocks each caller sees; there is no user id in the edit path, so only your own profile changes.
export const profileApi = {
  /** Your own profile: all four blocks. */
  mine: () => auth.request<Profile>("GET", "/users/me/profile"),
  /** Only the fields sent change; the answer is the whole profile. */
  update: (body: UpdateProfileRequest) =>
    auth.request<Profile>("PATCH", "/users/me/profile", { body }),
};
