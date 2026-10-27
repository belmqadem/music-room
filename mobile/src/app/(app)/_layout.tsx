import { Stack } from "expo-router";
import { useEffect } from "react";
import { StackHeader } from "@/components";
import { syncPlaylistChanges } from "@/features/playlist-editor/offline-edits";

// Signed-in app: the tabs, with the other screens pushed on top of them. Pushed screens get the
// app's own header (a round back button and the title); each screen sets its title.
// A screen opened by its address (a link, or a refresh on the web) gets the tabs underneath it, so
// its back button always leads home instead of disappearing (ADR-050).
export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
  // Changes made offline in an earlier session are sent as soon as the app opens online (ADR-049).
  useEffect(syncPlaylistChanges, []);
  return (
    <Stack
      screenOptions={{
        header: ({ options, back, navigation }) => (
          <StackHeader
            title={options.title ?? ""}
            onBack={back ? navigation.goBack : undefined}
          />
        ),
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
