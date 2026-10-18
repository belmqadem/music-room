import type { ColorName } from "@/theme/tokens.generated";
import type { TextTone } from "./text-styles";

// DESIGN.md: Electric Ember is the one primary accent and there is ONE primary button per screen;
// its pressed state is ember-hover; text on a bright fill is the inverse color, never white.
export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonState = "idle" | "pressed" | "disabled";

// 48 px high (the touch target), radius lg, a 1 px border on every variant so sizes never jump.
const BASE = "min-h-12 flex-row items-center justify-center rounded-lg border px-5";

const SURFACE: Record<ButtonVariant, Record<ButtonState, string>> = {
  primary: {
    idle: "bg-ember border-transparent",
    pressed: "bg-ember-hover border-transparent",
    disabled: "bg-surface-high border-transparent",
  },
  secondary: {
    idle: "bg-transparent border-line-subtle",
    pressed: "bg-surface-high border-line-subtle",
    disabled: "bg-transparent border-line-subtle",
  },
  ghost: {
    idle: "bg-transparent border-transparent",
    pressed: "bg-surface-low border-transparent",
    disabled: "bg-transparent border-transparent",
  },
};

const LABEL: Record<ButtonVariant, TextTone> = {
  primary: "inverse",
  secondary: "primary",
  ghost: "secondary",
};

export interface ButtonLook {
  container: string;
  labelTone: TextTone;
  /** The spinner shown instead of the label while loading. */
  spinnerColor: ColorName;
}

export function buttonLook(
  variant: ButtonVariant,
  state: ButtonState,
  fullWidth: boolean,
): ButtonLook {
  return {
    container: `${BASE} ${SURFACE[variant][state]} ${fullWidth ? "self-stretch" : "self-start"}`,
    labelTone: state === "disabled" ? "tertiary" : LABEL[variant],
    spinnerColor: variant === "primary" ? "contentInverse" : "contentPrimary",
  };
}

/** While loading the label stays (so the width does not change) but is hidden under the spinner. */
export const BUTTON_LABEL_HIDDEN = "opacity-0";
export const BUTTON_SPINNER_LAYER = "absolute inset-0 items-center justify-center";
