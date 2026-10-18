import { colors } from "./tokens.generated";

// The colors React Navigation uses for headers, tab bars and screen backgrounds, from the tokens.
// `primary` (back buttons, active tabs) is the primary TEXT color, not Ember: Ember is for the one
// main action of a screen (DESIGN.md rule 3).
export const navigationColors = {
  primary: colors.contentPrimary,
  background: colors.canvas,
  card: colors.canvas,
  text: colors.contentPrimary,
  border: colors.lineSubtle,
  notification: colors.error,
} as const;
