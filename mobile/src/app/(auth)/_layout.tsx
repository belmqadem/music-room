import { Stack } from "expo-router";

// Signed-out flow. The welcome screen is the "/" route (index).
export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
