import { Stack } from "expo-router";

// Signed-in app: the tabs, with the other screens pushed on top of them. The back button is the
// arrow only, as on the auth screens: otherwise it shows the tab group's route name, "(tabs)".
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
