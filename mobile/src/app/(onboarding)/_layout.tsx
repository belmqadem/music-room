import { Stack } from "expo-router";

// Signed in, username not chosen yet (ADR-046): only the screen that chooses it, with no header
// and no way back into the app until it is done.
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
