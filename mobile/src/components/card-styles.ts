// DESIGN.md: depth comes from surface tiers, never from shadows. Low for cards and list rows,
// elevated for modals and track-list surfaces, high for a selected one. Radius xl, hairline border.
export type CardTone = "low" | "elevated" | "selected";

const BASE = "rounded-xl border border-line-subtle p-4";

const SURFACE: Record<CardTone, string> = {
  low: "bg-surface-low",
  elevated: "bg-surface-elevated",
  selected: "bg-surface-high",
};

export const cardClasses = (tone: CardTone): string => `${BASE} ${SURFACE[tone]}`;
