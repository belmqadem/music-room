import { View } from "react-native";
import { badgeLook, type BadgeTone } from "./badge-styles";
import { Text } from "./Text";

export interface BadgeProps {
  label: string;
  /** "live" (Chartreuse) is only for live / realtime things such as presence and sync. */
  tone?: BadgeTone;
}

export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const look = badgeLook(tone);
  return (
    <View className={look.container}>
      <Text variant="badge" tone={look.labelTone}>
        {label}
      </Text>
    </View>
  );
}
