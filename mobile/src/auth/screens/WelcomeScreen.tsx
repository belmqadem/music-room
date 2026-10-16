import { ScrollView, Text } from "react-native";
import DevScreenLinks from "@/dev/DevScreenLinks";

// Onboarding shown on first launch, with the way into sign-in and sign-up.
export default function WelcomeScreen() {
  return (
    <ScrollView contentContainerClassName="flex-grow items-center justify-center">
      <Text>welcome</Text>
      <DevScreenLinks />
    </ScrollView>
  );
}
