import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components";
import { initialsOf } from "./initials";

/** The top of a profile, yours or someone else's: initials in a round avatar, then the name. */
export function ProfileHeader({
  displayName,
  children,
}: {
  displayName: string;
  /** Under the name: your email, or someone's friend actions. */
  children?: ReactNode;
}) {
  return (
    <View className="items-center gap-4">
      <View className="h-24 w-24 items-center justify-center rounded-full border border-line-subtle bg-surface-elevated">
        <Text variant="hero">{initialsOf(displayName)}</Text>
      </View>
      <Text variant="h1" className="text-center">
        {displayName}
      </Text>
      {children}
    </View>
  );
}
