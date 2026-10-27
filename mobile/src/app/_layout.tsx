import "@/global.css";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";
import { auth, useAuth } from "@/auth";

import { navigationTheme, useAppFonts } from "@/theme";

// Keep the splash screen up until the fonts are loaded and the stored session is checked.
void SplashScreen.preventAutoHideAsync();

// Three route groups: (auth) for signed-out users, (onboarding) for a signed-in user who has not
// chosen a username yet (ADR-046), (app) for everyone else. A guarded group cannot be reached; the
// router sends the user to the first group that is available.
export default function RootLayout() {
  const { status, user } = useAuth();
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

  // Signed out: only the sign-in screens. Signed in: only the app. A screen of the other group
  // cannot be opened, even by its URL; the server checks every request again anyway.
  const signedIn = status === "signedIn";
  // The server refuses the rest until a name is chosen anyway; this just shows the right screen.
  const named = signedIn && user?.displayNameSet === true;
  return (
    <ThemeProvider value={navigationTheme}>
      {/* Dark app: light status bar icons. */}
      <StatusBar style="light" />
      {/* The whole app sits in one centered column (maxWidth.content, ADR-050): a phone is
          narrower, so nothing changes there; a tablet or a browser window gets a column instead of
          stretched screens. The canvas fills the rest. */}
      <View className="flex-1 bg-canvas">
        <View className="w-full max-w-content flex-1 self-center">
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={signedIn && !named}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={named}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
          </Stack>
        </View>
      </View>
    </ThemeProvider>
  );
}
