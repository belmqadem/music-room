import { Pressable } from "react-native";
import type { TypographyVariant } from "@/theme/tokens.generated";
import { Icon, type IconName } from "./Icon";

export interface IconButtonProps {
  icon: IconName;
  /** Read by screen readers: the icon alone says nothing. */
  accessibilityLabel: string;
  onPress: () => void;
  /** The icon's size, as the line height of this text style (see Icon). */
  size?: TypographyVariant;
  /** Dimmed and not pressable, like a disabled Button. */
  disabled?: boolean;
}

/**
 * A round button with only an icon: the back button, and the pencils that edit something. A
 * surface tier with a hairline, a higher tier while pressed (DESIGN.md rules 2 and 8).
 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = "body",
  disabled = false,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      className={`h-10 w-10 items-center justify-center rounded-full border border-line-subtle bg-surface-low active:bg-surface-high ${disabled ? "opacity-40" : ""}`}
    >
      <Icon name={icon} size={size} tone="primary" />
    </Pressable>
  );
}
