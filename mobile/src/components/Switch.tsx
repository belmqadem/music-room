import { Switch as NativeSwitch } from "react-native";
import { colors } from "@/theme/tokens.generated";

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Read by screen readers: what the switch turns on. */
  accessibilityLabel: string;
  disabled?: boolean;
}

/**
 * An on/off setting. On is Ember (the action color); off sits one surface tier up, so the track
 * stays visible on a card. Chartreuse is not used: it means "live" (DESIGN.md rule 4).
 */
export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
}: SwitchProps) {
  return (
    <NativeSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      trackColor={{ false: colors.surfaceBright, true: colors.ember }}
      thumbColor={colors.contentPrimary}
      ios_backgroundColor={colors.surfaceBright}
    />
  );
}
