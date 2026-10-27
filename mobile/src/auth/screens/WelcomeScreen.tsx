import { router } from "expo-router";
import { Image, View } from "react-native";
import { Button, Screen, Text } from "@/components";
import { copy } from "@/copy";

// The picture behind the welcome screen. Replace the file, same name and format, to change it; a
// tall, dark photo works best (it is shown at 40% over the canvas, so the text stays readable).
const BACKGROUND = require("../../../assets/images/welcome-background.png");

// The first screen when signed out: what the app is, and the two ways in. One primary action.
export default function WelcomeScreen() {
  return (
    <Screen
      scroll
      topInset
      background={
        <Image
          source={BACKGROUND}
          className="h-full w-full opacity-40"
          resizeMode="cover"
          accessible={false}
        />
      }
    >
      <View className="flex-1 justify-center gap-4 py-12">
        <Text variant="hero">{copy.welcome.headline}</Text>
        <Text variant="bodyLarge" tone="secondary">
          {copy.welcome.intro}
        </Text>
      </View>
      <View className="gap-3">
        <Button
          title={copy.welcome.createAccount}
          fullWidth
          onPress={() => router.push("/sign-up")}
        />
        <Button
          title={copy.welcome.signIn}
          variant="secondary"
          fullWidth
          onPress={() => router.push("/sign-in")}
        />
        <Button
          title={copy.welcome.serverAddress}
          variant="ghost"
          fullWidth
          onPress={() => router.push("/server-address")}
        />
      </View>
    </Screen>
  );
}
