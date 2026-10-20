import { Pressable, View } from "react-native";
import { CHOICE_GROUP_CLASS, choiceLook } from "./choice-styles";
import { Text } from "./Text";

export interface ChoiceGroupProps<T extends string | number> {
  /** Shown above the choices and read by screen readers. */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Explains the current choice, under the options. */
  helper?: string;
}

/** One choice among a few (a radio group), as pills that wrap. */
export function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  helper,
}: ChoiceGroupProps<T>) {
  return (
    <View className="gap-2">
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className={CHOICE_GROUP_CLASS}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const look = choiceLook(selected);
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              className={look.container}
            >
              <Text variant="h3" tone={look.labelTone}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {helper ? (
        <Text variant="caption" tone="secondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}
