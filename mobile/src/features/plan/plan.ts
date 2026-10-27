import type { Plan, SetPlanRequest, User } from "@music-room/shared";
import { isRequestError } from "@/api/api-error";
import { auth } from "@/auth";
import { MESSAGES } from "@/auth/forms/error-messages";
import { copy } from "@/copy";

// Free and Premium in the app (ADR-048). The server decides on every request; these only decide
// what the app SHOWS: a Premium feature a Free user cannot use is explained instead of failing.

export const isPremium = (user: Pick<User, "plan"> | null | undefined): boolean =>
  user?.plan === "premium";

/**
 * Editing a playlist needs both: the playlist's own license (`myPermissions.canAct`, from the
 * server) and Premium. Kept apart so the app can say WHY you can't: the license, or the plan.
 */
export function playlistEditing(
  canAct: boolean,
  user: Pick<User, "plan"> | null | undefined,
) {
  if (!canAct) return "not-allowed" as const;
  return isPremium(user) ? ("allowed" as const) : ("needs-premium" as const);
}

/** Switches plan (payment simulated), then reads the user again so the whole app follows. */
export async function switchPlan(plan: Plan): Promise<void> {
  const body: SetPlanRequest = { plan };
  await auth.request<User>("PUT", "/users/me/plan", { body });
  await auth.refreshUser();
}

export function planErrorMessage(error: unknown): string {
  if (!isRequestError(error)) return copy.errors.unknown;
  switch (error.code) {
    case "NETWORK_ERROR":
      return MESSAGES.network;
    case "RATE_LIMITED":
      return MESSAGES.rateLimited;
    default:
      return error.status >= 500 ? MESSAGES.server : copy.errors.unknown;
  }
}
