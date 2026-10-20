import type { TextTone } from "./text-styles";

// DESIGN.md: a track row is a list row (surface low, hairline border, radius xl). Ember is the
// "active voting state", so a track I voted for has an Ember vote control with inverse text;
// otherwise the control is outlined. The playing track is not votable: no control, a badge instead.

export const TRACK_ROW_CLASS =
  "flex-row items-center gap-3 rounded-xl border border-line-subtle bg-surface-low p-3";
export const TRACK_COVER_CLASS = "size-12 rounded-md bg-surface-high";
export const TRACK_TEXT_CLASS = "flex-1 gap-1";

export interface VoteLook {
  container: string;
  labelTone: TextTone;
}

const VOTE_BASE = "min-h-12 min-w-16 items-center justify-center rounded-lg border px-3";

export function voteLook(votedByMe: boolean, disabled: boolean): VoteLook {
  if (disabled) {
    return {
      container: `${VOTE_BASE} border-line-subtle bg-transparent`,
      labelTone: "tertiary",
    };
  }
  return votedByMe
    ? { container: `${VOTE_BASE} border-transparent bg-ember`, labelTone: "inverse" }
    : {
        container: `${VOTE_BASE} border-line-subtle bg-transparent`,
        labelTone: "primary",
      };
}
