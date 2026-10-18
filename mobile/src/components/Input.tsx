import { useState, type Ref } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { colors, typography } from "@/theme/tokens.generated";
import {
  INPUT_FIELD_CLASS,
  INPUT_TEXT_CLASS,
  inputClasses,
  resolveInputState,
} from "./input-styles";
import { Text } from "./Text";

export interface InputProps extends Omit<
  TextInputProps,
  | "style"
  | "className"
  | "placeholderTextColor"
  | "selectionColor"
  | "cursorColor"
  | "keyboardAppearance"
  | "accessibilityLabel"
> {
  /** Always shown above the field and read by screen readers; a placeholder is not a label. */
  label: string;
  /** Replaces the helper line and turns the field red. */
  error?: string | null;
  helper?: string;
  /** To move focus to the next field (React 19: a ref is a normal prop). */
  ref?: Ref<TextInput>;
}

// The field text uses the body-large style without its line height: a fixed line height clips text
// inside a TextInput on some devices.
const { lineHeight: _lineHeight, ...FIELD_TEXT } = typography.bodyLarge;

export function Input({
  label,
  error,
  helper,
  onFocus,
  onBlur,
  ref,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const state = resolveInputState(focused, Boolean(error));

  return (
    <View className={INPUT_FIELD_CLASS}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View className={inputClasses(state)}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.contentPlaceholder}
          selectionColor={colors.ember}
          cursorColor={colors.ember}
          keyboardAppearance="dark"
          className={INPUT_TEXT_CLASS}
          style={FIELD_TEXT}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="error" accessibilityRole="alert">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="secondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}
