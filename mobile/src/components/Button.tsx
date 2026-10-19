import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors } from "@/theme/tokens.generated";
import {
  BUTTON_SPINNER_LAYER,
  buttonContentClass,
  buttonLook,
  type ButtonState,
  type ButtonVariant,
} from "./button-styles";
import { Text } from "./Text";

export interface ButtonProps {
  title: string;
  onPress: () => void;
  /** primary = Ember, ONE per screen. secondary = outlined. ghost = text only. */
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner and ignores presses until the work is done. */
  loading?: boolean;
  fullWidth?: boolean;
  /** Shown before the title, e.g. a provider logo. Decorative: screen readers read the title. */
  icon?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const [pressed, setPressed] = useState(false);
  const state: ButtonState = disabled
    ? "disabled"
    : pressed && !loading
      ? "pressed"
      : "idle";
  const look = buttonLook(variant, state, fullWidth);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className={look.container}
      testID={testID}
    >
      <View className={buttonContentClass(loading)}>
        {icon}
        <Text variant="h3" tone={look.labelTone}>
          {title}
        </Text>
      </View>
      {loading ? (
        <View className={BUTTON_SPINNER_LAYER}>
          <ActivityIndicator color={colors[look.spinnerColor]} />
        </View>
      ) : null}
    </Pressable>
  );
}
