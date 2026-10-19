import { View } from "react-native";
import { Text } from "@/components";

// Create an event: name, visibility (public or private) and who may vote (everyone, invited only, or place and time).
export default function CreateEventScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <Text>create-event</Text>
    </View>
  );
}
