import { View } from "react-native";
import { avatarLook, type AvatarSize } from "./avatar-styles";
import { initialsOf } from "./initials";
import { Text } from "./Text";

export interface AvatarProps {
  /** Whose: their initials stand in for a photo. */
  name: string;
  /** sm beside a name in a row, lg at the top of a profile. Default: sm. */
  size?: AvatarSize;
}

/** Decorative: the name is always written next to it, so screen readers skip it. */
export function Avatar({ name, size = "sm" }: AvatarProps) {
  const look = avatarLook(size);
  return (
    <View
      className={look.container}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant={look.lettersVariant}>{initialsOf(name)}</Text>
    </View>
  );
}
