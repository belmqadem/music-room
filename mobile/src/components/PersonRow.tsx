import type { UserSummary } from "@music-room/shared";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { Text } from "./Text";

export interface PersonRowProps {
  user: UserSummary;
  /** Opens the person (their profile): the row is a button with a chevron then. */
  onPress?: () => void;
  /** Read by screen readers when the row opens something. */
  accessibilityLabel?: string;
  /** Actions on the right (Invite, Remove) or under the name (Accept, Decline). */
  children?: ReactNode;
  /** Actions under the name instead of on the right: for two buttons that would not fit beside it. */
  actionsBelow?: boolean;
}

/** One person, by their username: unique (ADR-046), so it alone tells people apart. */
export function PersonRow({
  user,
  onPress,
  accessibilityLabel,
  children,
  actionsBelow = false,
}: PersonRowProps) {
  const who = (
    <View className="flex-1">
      <Text variant="h3" numberOfLines={1}>
        {user.displayName}
      </Text>
    </View>
  );
  const top = (
    <View className="flex-row items-center gap-3">
      {who}
      {actionsBelow ? null : children}
      {onPress ? <Icon name="chevronRight" tone="tertiary" /> : null}
    </View>
  );
  return (
    <Card className="gap-3">
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          className="active:opacity-70"
        >
          {top}
        </Pressable>
      ) : (
        top
      )}
      {actionsBelow ? <View className="flex-row gap-3">{children}</View> : null}
    </Card>
  );
}
