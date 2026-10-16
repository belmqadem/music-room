import { Stack } from "expo-router";

// Signed-in app: the tabs, with the other screens pushed on top of them.
export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
