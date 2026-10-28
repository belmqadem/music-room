import type { TypographyVariant } from "@/theme/tokens.generated";

// A person's picture until photos exist: their initials in a round, neutral tile (DESIGN.md: avatars
// are rounded full). Neutral on purpose: Ember is for the one primary action, Chartreuse for live.
export type AvatarSize = "sm" | "lg";

const BASE =
  "items-center justify-center rounded-full border border-line-subtle bg-surface-elevated";

const SIZE: Record<AvatarSize, { box: string; letters: TypographyVariant }> = {
  sm: { box: "h-10 w-10", letters: "h3" },
  lg: { box: "h-24 w-24", letters: "hero" },
};

export const avatarLook = (
  size: AvatarSize,
): { container: string; lettersVariant: TypographyVariant } => ({
  container: `${BASE} ${SIZE[size].box}`,
  lettersVariant: SIZE[size].letters,
});
