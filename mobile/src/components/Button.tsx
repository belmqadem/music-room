import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { colors } from "@/theme/tokens.generated";
import {
  BUTTON_LABEL_HIDDEN,
  BUTTON_SPINNER_LAYER,
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
      <View className={loading ? BUTTON_LABEL_HIDDEN : undefined}>
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
