import "@/global.css";
import { Stack } from "expo-router";
import { IS_SIGNED_IN, TEMP_ALLOW_ALL_ROUTES } from "@/auth/signed-in-flag";

// Two route groups: (auth) for signed-out users, (app) for signed-in users. A guarded group cannot
// be reached; the router sends the user to the first group that is available.
export default function RootLayout() {
  const showAuth = !IS_SIGNED_IN || TEMP_ALLOW_ALL_ROUTES;
  const showApp = IS_SIGNED_IN || TEMP_ALLOW_ALL_ROUTES;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={showAuth}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={showApp}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
