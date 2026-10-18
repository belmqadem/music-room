import "@/global.css";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { auth, useAuth } from "@/auth";
import { TEMP_ALLOW_ALL_ROUTES } from "@/dev/temp-flags";
import { useAppFonts } from "@/theme";

// Keep the splash screen up until the fonts are loaded and the stored session is checked.
void SplashScreen.preventAutoHideAsync();

// Two route groups: (auth) for signed-out users, (app) for signed-in users. A guarded group cannot
// be reached; the router sends the user to the first group that is available.
export default function RootLayout() {
  const { status } = useAuth();
  const fontsReady = useAppFonts();
  const ready = fontsReady && status !== "loading";

  // Sign in again from the stored refresh token, once, when the app starts.
  useEffect(() => {
    void auth.restore();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  // Until then show nothing, rather than flashing the wrong group or the wrong font.
  if (!ready) return null;

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
