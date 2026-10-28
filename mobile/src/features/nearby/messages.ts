import { copy } from "@/copy";
import type { EnableOutcome } from "./nearby-native";

// What Settings says when turning on rooms near you didn't work (ADR-052), and whether only the
// phone's own settings can fix it. Each refusal says what is missing, literally.

export type EnableProblem = Exclude<EnableOutcome, "on">;

export function enableProblemMessage(problem: EnableProblem): string {
  return copy.nearby.errors[problem];
}

/** The system won't ask again for these: the fix is in the phone's settings. */
export function needsPhoneSettings(problem: EnableProblem): boolean {
  return (
    problem === "locationDenied" ||
    problem === "alwaysDenied" ||
    problem === "notificationsDenied"
  );
}
