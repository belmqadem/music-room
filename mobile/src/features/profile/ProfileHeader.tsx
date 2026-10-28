import type { ReactNode } from "react";
import { View } from "react-native";
import { Avatar, Text } from "@/components";

/**
 * The top of a profile, yours or someone else's: initials in a round avatar, the name with small
 * lines right under it, then any actions.
 */
export function ProfileHeader({
  displayName,
  subtitle,
  children,
}: {
  displayName: string;
  /** Small lines right under the name: your email, or someone's full name and city. */
  subtitle?: ReactNode;
  /** Below, with more room: someone's friend actions. */
  children?: ReactNode;
}) {
  return (
    <View className="items-center gap-4">
      <Avatar name={displayName} size="lg" />
      <View className="items-center gap-1">
        <Text variant="h1" className="text-center">
          {displayName}
        </Text>
        {subtitle}
      </View>
      {children}
    </View>
  );
}
