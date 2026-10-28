import type { TextTone } from "./text-styles";

// A small pill. Text on a bright fill is the inverse color (DESIGN.md rule 5). "live" is Chartreuse
// and is reserved for live / realtime things (presence, sync): do not use it to decorate.
export type BadgeTone = "neutral" | "accent" | "live" | "success" | "warning" | "error";

const BASE = "self-start rounded-full px-2 py-1";

const LOOK: Record<BadgeTone, { fill: string; label: TextTone }> = {
  neutral: { fill: "bg-surface-high", label: "primary" },
  accent: { fill: "bg-ember", label: "inverse" },
  live: { fill: "bg-chartreuse", label: "inverse" },
  success: { fill: "bg-success", label: "inverse" },
  warning: { fill: "bg-warning", label: "inverse" },
  error: { fill: "bg-error", label: "inverse" },
};

export const badgeLook = (
  tone: BadgeTone,
): { container: string; labelTone: TextTone } => ({
  container: `${BASE} ${LOOK[tone].fill}`,
  labelTone: LOOK[tone].label,
});
