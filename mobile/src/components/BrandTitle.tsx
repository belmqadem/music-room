import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { Platform } from "react-native";
import { colors } from "@/theme";
import { Text } from "./Text";

// The brand gradient (ADR-051): Ember to Chartreuse, left to right. DESIGN.md keeps Chartreuse for
// live content; the app's name in the brand header is the one written exception.
const STOPS = [colors.ember, colors.chartreuse] as const;
const LEFT = { x: 0, y: 0 };
const RIGHT = { x: 1, y: 0 };
const HIDDEN = { opacity: 0 } as const;
const TRANSPARENT = { color: "transparent" } as const;

/**
 * The app's name in the brand header, in the brand gradient. On the web the browser clips a CSS
 * gradient to the text. Android and iOS cannot do that, so the gradient is drawn and the text is
 * used as its mask (MaskedView); an invisible copy of the text gives the gradient its size.
 */
export function BrandTitle({ children }: { children: string }) {
  if (Platform.OS === "web") {
    return (
      <Text
        variant="brandTitle"
        accessibilityRole="header"
        numberOfLines={1}
        className="bg-linear-to-r from-ember to-chartreuse bg-clip-text"
        style={TRANSPARENT}
      >
        {children}
      </Text>
    );
  }
  return (
    <MaskedView
      accessible
      accessibilityRole="header"
      accessibilityLabel={children}
      maskElement={
        <Text variant="brandTitle" numberOfLines={1}>
          {children}
        </Text>
      }
    >
      <LinearGradient colors={STOPS} start={LEFT} end={RIGHT}>
        <Text variant="brandTitle" numberOfLines={1} style={HIDDEN}>
          {children}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
}
