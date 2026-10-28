import { Stack } from "expo-router";
import { StackHeader } from "@/components";

// Signed-out flow. The welcome screen is the "/" route (index) and has no header; the others get a
// back button only, because each screen shows its own title.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        title: "",
        header: ({ options, back, navigation }) => (
          <StackHeader
            title={options.title ?? ""}
            onBack={back ? navigation.goBack : undefined}
          />
        ),
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="gallery" options={{ title: "Components" }} />
    </Stack>
  );
}
