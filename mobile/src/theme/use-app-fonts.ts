import { useFonts } from "expo-font";
import { useEffect } from "react";
import { fontAssets } from "./fonts.generated";

/**
 * Loads the app's fonts (the weights of the design tokens). Returns true when the app may render:
 * the fonts are loaded, or loading failed. A failed load is logged and the system font is used
 * instead, so a missing font never blocks the app.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontAssets);
  useEffect(() => {
    if (error)
      console.warn("Could not load the app fonts, using the system font:", error);
  }, [error]);
  return loaded || error !== null;
}
