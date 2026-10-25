import { Stack } from "expo-router";
import { StackHeader } from "@/components";

// Signed-in app: the tabs, with the other screens pushed on top of them. Pushed screens get the
// app's own header (a round back button and the title); each screen sets its title.
export default function AppLayout() {
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
