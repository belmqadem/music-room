import { Image, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "@/copy";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

// The app's own headers, the same on iOS and Android, set as the navigators' `header` (the native
// bars looked dated and differed per platform). Both sit on the canvas with no hairline: depth comes
// from surface tiers, not lines (DESIGN.md rule 2). Each pads itself below the status bar.

/** Tab screens: no title (the tab bar says where you are), only room for the status bar. */
export function StatusBarSpace() {
  const insets = useSafeAreaInsets();
  return <View className="bg-canvas" style={{ height: insets.top }} />;
}

const BRAND_MARK = require("../../assets/images/brand-mark.png");

/**
 * The main lists (Rooms, Playlists): the logo's rings and the app's name, centered on a band one
 * surface tier above the canvas (depth from surfaces, DESIGN.md rule 2) that runs under the status
 * bar and rounds off at the bottom. The name is in the display font, like the welcome headline.
 */
export function BrandHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-canvas pb-2">
      <View
        className="flex-row items-center justify-center gap-3 rounded-b-2xl bg-surface-low pb-4"
        style={{ paddingTop: insets.top + 12 }}
        accessibilityRole="header"
        accessibilityLabel={copy.app.name}
      >
        <Image source={BRAND_MARK} className="h-9 w-9" accessible={false} />
        <Text variant="h1" numberOfLines={1}>
          {copy.app.name}
        </Text>
      </View>
    </View>
  );
}

/** Pushed screens: a round back button and the title, centered and kept to one line. */
export function StackHeader({
  title,
  onBack,
}: {
  title: string;
  /** Absent on the first screen of a stack: no back button then. */
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center gap-3 bg-canvas px-5 py-2"
      style={{ marginTop: insets.top }}
    >
      {onBack ? (
        <IconButton
          icon="back"
          size="h3"
          accessibilityLabel={copy.common.back}
          onPress={onBack}
        />
      ) : (
        <View className="h-10 w-10" />
      )}
      <Text variant="h3" numberOfLines={1} className="flex-1 text-center">
        {title}
      </Text>
      {/* Balances the back button, so the title stays centered on the screen. */}
      <View className="h-10 w-10" />
    </View>
  );
}
