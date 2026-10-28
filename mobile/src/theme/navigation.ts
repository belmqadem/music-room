import type { Theme } from "expo-router";
import { navigationColors } from "./navigation-colors";
import { fontFamilies } from "./tokens.generated";

// Headers, the tab bar and the background behind every screen follow the dark design system, so a
// white header or a white flash between screens never appears. Each font is its own loaded file, so
// the weight is "normal" (asking for bold on top of a bold file would fake it twice).
const font = (fontFamily: string) => ({ fontFamily, fontWeight: "normal" as const });

export const navigationTheme: Theme = {
  dark: true,
  colors: navigationColors,
  fonts: {
    regular: font(fontFamilies.sans["400"]),
    medium: font(fontFamilies.sans["500"]),
    bold: font(fontFamilies.sans["700"]),
    heavy: font(fontFamilies.display["800"]),
  },
};
