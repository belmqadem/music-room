import type { TextTone } from "./text-styles";

// DESIGN.md: a selected item is the "high" surface tier (rule 2), not a second accent; the one Ember
// button of the screen stays its main action. 48 px high, like every touch target.

export const CHOICE_GROUP_CLASS = "flex-row flex-wrap gap-2";

export interface ChoiceLook {
  container: string;
  labelTone: TextTone;
}

const BASE = "min-h-12 items-center justify-center rounded-lg border px-4";

export function choiceLook(selected: boolean): ChoiceLook {
  return selected
    ? { container: `${BASE} border-line-subtle bg-surface-high`, labelTone: "primary" }
    : { container: `${BASE} border-line-subtle bg-transparent`, labelTone: "secondary" };
}
