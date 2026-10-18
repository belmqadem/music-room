// DESIGN.md: input fills are the recessed surface-lowest tier, the border is a 1 px hairline, and the
// focus ring is Ember. An error is red and wins over focus, so the message and the field agree.
export type InputState = "idle" | "focused" | "error";

const BASE = "min-h-12 justify-center rounded-lg border bg-surface-lowest px-4";

const BORDER: Record<InputState, string> = {
  idle: "border-line-subtle",
  focused: "border-line-focus",
  error: "border-error",
};

/** An error wins over focus, so the red border and the message always agree. */
export const resolveInputState = (focused: boolean, hasError: boolean): InputState =>
  hasError ? "error" : focused ? "focused" : "idle";

export const inputClasses = (state: InputState): string => `${BASE} ${BORDER[state]}`;

export const INPUT_TEXT_CLASS = "text-content-primary";
export const INPUT_FIELD_CLASS = "gap-1.5";
