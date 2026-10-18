import "@/global.css";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { auth, useAuth } from "@/auth";
import { TEMP_ALLOW_ALL_ROUTES } from "@/dev/temp-flags";

// Two route groups: (auth) for signed-out users, (app) for signed-in users. A guarded group cannot
// be reached; the router sends the user to the first group that is available.
export default function RootLayout() {
  const { status } = useAuth();

  // Sign in again from the stored refresh token, once, when the app starts.
  useEffect(() => {
    void auth.restore();
  }, []);

  // Until the stored session is checked, show nothing rather than flashing the wrong group.
  if (status === "loading") return null;

  const showAuth = status !== "signedIn" || TEMP_ALLOW_ALL_ROUTES;
  const showApp = status === "signedIn" || TEMP_ALLOW_ALL_ROUTES;
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
