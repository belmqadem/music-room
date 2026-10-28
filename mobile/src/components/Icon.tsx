import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { colors, typography, type TypographyVariant } from "@/theme/tokens.generated";

// An icon from the system set (SF Symbols on iOS, Material Symbols on Android and web; expo-symbols).
// There is no icon-size token: an icon takes the line height of the text it sits next to, so it
// lines up with that text and scales with the type scale. Decorative: the text next to it carries
// the meaning for screen readers.

/** The icons the app uses, one name per platform. */
export const ICONS = {
  back: { ios: "chevron.left", android: "arrow_back", web: "arrow_back" },
  chevronRight: { ios: "chevron.right", android: "chevron_right", web: "chevron_right" },
  bio: { ios: "text.quote", android: "format_quote", web: "format_quote" },
  about: { ios: "person", android: "person", web: "person" },
  friends: { ios: "person.2", android: "group", web: "group" },
  music: { ios: "music.note", android: "music_note", web: "music_note" },
  play: { ios: "play.fill", android: "play_arrow", web: "play_arrow" },
  pause: { ios: "pause.fill", android: "pause", web: "pause" },
  edit: { ios: "pencil", android: "edit", web: "edit" },
  check: { ios: "checkmark", android: "check", web: "check" },
  close: { ios: "xmark", android: "close", web: "close" },
  offline: { ios: "icloud.slash", android: "cloud_off", web: "cloud_off" },
  link: { ios: "link", android: "link", web: "link" },
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  signOut: {
    ios: "rectangle.portrait.and.arrow.right",
    android: "logout",
    web: "logout",
  },
} as const satisfies Record<string, SymbolViewProps["name"]>;

export type IconName = keyof typeof ICONS;

const TONES = {
  primary: colors.contentPrimary,
  secondary: colors.contentSecondary,
  tertiary: colors.contentTertiary,
  error: colors.error,
} as const;

export interface IconProps {
  name: IconName;
  /** Sized as the line height of this text style. */
  size?: TypographyVariant;
  tone?: keyof typeof TONES;
}

export function Icon({ name, size = "body", tone = "secondary" }: IconProps) {
  return (
    <SymbolView
      name={ICONS[name]}
      size={typography[size].lineHeight}
      tintColor={TONES[tone]}
      accessible={false}
    />
  );
}
