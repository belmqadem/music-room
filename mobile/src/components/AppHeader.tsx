import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { copy } from "@/copy";
import { Icon } from "./Icon";
import { Text } from "./Text";

// The app's own headers, the same on iOS and Android, set as the navigators' `header` (the native
// bars looked dated and differed per platform). Both sit on the canvas with no hairline: depth comes
// from surface tiers, not lines (DESIGN.md rule 2). Each pads itself below the status bar.

/** Tab screens: no title (the tab bar says where you are), only room for the status bar. */
export function StatusBarSpace() {
  const insets = useSafeAreaInsets();
  return <View className="bg-canvas" style={{ height: insets.top }} />;
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
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={copy.common.back}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full border border-line-subtle bg-surface-low active:bg-surface-high"
        >
          <Icon name="back" size="h3" tone="primary" />
        </Pressable>
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
