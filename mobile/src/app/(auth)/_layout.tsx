import { Stack } from "expo-router";

// Signed-out flow. The welcome screen is the "/" route (index) and has no header; the others get a
// back button only, because each screen shows its own title.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        title: "",
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="gallery" options={{ title: "Components" }} />
    </Stack>
  );
}
