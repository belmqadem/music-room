import type { TypographyVariant } from "@/theme/tokens.generated";

// Text colors (DESIGN.md rule 6 and 7): primary for titles, secondary for metadata and labels,
// tertiary only for inactive things, placeholder for placeholders, inverse on bright fills,
// feedback colors for their fixed meanings. Chartreuse and Ember are never text colors (the one
// exception, the brand gradient on the app's name, is BrandTitle, ADR-051).
export type TextTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "placeholder"
  | "inverse"
  | "error"
  | "success"
  | "warning";

export const TEXT_TONE_CLASS: Record<TextTone, string> = {
  primary: "text-content-primary",
  secondary: "text-content-secondary",
  tertiary: "text-content-tertiary",
  placeholder: "text-content-placeholder",
  inverse: "text-content-inverse",
  error: "text-error",
  success: "text-success",
  warning: "text-warning",
};

/** Titles are announced as headings by screen readers. */
export const HEADING_VARIANTS: readonly TypographyVariant[] = ["hero", "h1", "h2"];
