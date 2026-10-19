import { View } from "react-native";
import { Text } from "@/components";

// Create a playlist: name, visibility (public or private) and who may edit (everyone or invited only).
export default function CreatePlaylistScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-canvas">
      <Text>create-playlist</Text>
    </View>
  );
}
