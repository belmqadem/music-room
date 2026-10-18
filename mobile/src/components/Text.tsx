import { Text as NativeText, type TextProps } from "react-native";
import { typography, type TypographyVariant } from "@/theme/tokens.generated";
import { HEADING_VARIANTS, TEXT_TONE_CLASS, type TextTone } from "./text-styles";

export interface AppTextProps extends TextProps {
  /** A step of the design system's type scale. Default: body. */
  variant?: TypographyVariant;
  /** Which text color. Default: primary. */
  tone?: TextTone;
}

/** All text in the app goes through this: the font, size, line height and color come from the tokens. */
export function Text({
  variant = "body",
  tone = "primary",
  className,
  style,
  accessibilityRole,
  ...rest
}: AppTextProps) {
  return (
    <NativeText
      accessibilityRole={
        accessibilityRole ?? (HEADING_VARIANTS.includes(variant) ? "header" : undefined)
      }
      // Large system fonts are allowed to grow the text, but not enough to break the layout.
      maxFontSizeMultiplier={1.3}
      className={
        className ? `${TEXT_TONE_CLASS[tone]} ${className}` : TEXT_TONE_CLASS[tone]
      }
      style={[typography[variant], style]}
      {...rest}
    />
  );
}
