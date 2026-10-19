/// <reference types="node" />
// Node types for this file only: TypeScript 6 does not load @types automatically, and the app code
// must not see Node globals.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { badgeLook, type BadgeTone } from "@/components/badge-styles";
import {
  buttonLook,
  type ButtonState,
  type ButtonVariant,
} from "@/components/button-styles";
import { cardClasses, type CardTone } from "@/components/card-styles";
import {
  INPUT_TEXT_CLASS,
  inputClasses,
  resolveInputState,
  type InputState,
} from "@/components/input-styles";
import {
  HEADING_VARIANTS,
  TEXT_TONE_CLASS,
  type TextTone,
} from "@/components/text-styles";
import { navigationColors } from "@/theme/navigation-colors";
import { colors, typography, type ColorName } from "@/theme/tokens.generated";

// The rules of DESIGN.md, checked on what each component asks for. The components themselves are
// thin: they pass these classes to React Native.

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");

const camel = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const classesOf = (value: string) => value.split(/\s+/).filter(Boolean);
/** The token color a class like bg-ember or text-content-primary stands for (null for non-colors). */
function colorOf(cls: string): string | null {
  const match = /^(?:bg|text|border)-(.+)$/.exec(cls);
  const name = match ? camel(match[1]!) : "";
  return name in colors ? colors[name as ColorName] : null;
}
const fillOf = (container: string) =>
  classesOf(container).find((c) => c.startsWith("bg-"));
const toneColor = (tone: TextTone) => colorOf(TEXT_TONE_CLASS[tone])!;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost"];
const STATES: ButtonState[] = ["idle", "pressed", "disabled"];
const BADGE_TONES: BadgeTone[] = [
  "neutral",
  "accent",
  "live",
  "success",
  "warning",
  "error",
];
const CARD_TONES: CardTone[] = ["low", "elevated", "selected"];
const INPUT_STATES: InputState[] = ["idle", "focused", "error"];

describe("Text", () => {
  it("every tone is a real token color, and never Ember or Chartreuse (those are fills, not text)", () => {
    for (const tone of Object.keys(TEXT_TONE_CLASS) as TextTone[]) {
      expect(colorOf(TEXT_TONE_CLASS[tone])).not.toBeNull();
      expect([colors.ember, colors.emberHover, colors.chartreuse]).not.toContain(
        colorOf(TEXT_TONE_CLASS[tone]),
      );
    }
  });

  it("announces only the big titles as headings", () => {
    expect([...HEADING_VARIANTS]).toEqual(["hero", "h1", "h2"]);
    for (const variant of HEADING_VARIANTS) expect(variant in typography).toBe(true);
  });

  it("reads at least 4.5:1 for primary and secondary text on the canvas and on cards", () => {
    for (const surface of [colors.canvas, colors.surfaceLow]) {
      expect(contrast(toneColor("primary"), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(toneColor("secondary"), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("Button", () => {
  it("primary is Ember at rest, ember-hover when pressed, with the inverse label (never white)", () => {
    const idle = buttonLook("primary", "idle", false);
    const pressed = buttonLook("primary", "pressed", false);

    expect(colorOf(fillOf(idle.container)!)).toBe(colors.ember);
    expect(colorOf(fillOf(pressed.container)!)).toBe(colors.emberHover);
    for (const look of [idle, pressed]) {
      expect(look.labelTone).toBe("inverse");
      expect(
        contrast(toneColor(look.labelTone), colorOf(fillOf(look.container)!)!),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("only the primary button is ever Ember", () => {
    for (const variant of VARIANTS) {
      for (const state of STATES) {
        const container = buttonLook(variant, state, false).container;
        const usesEmber = /\b(bg|border)-ember(-hover)?\b/.test(container);
        expect(usesEmber, `${variant}/${state}`).toBe(
          variant === "primary" && state !== "disabled",
        );
      }
    }
  });

  it("a disabled button is not Ember and reads as inactive", () => {
    for (const variant of VARIANTS) {
      expect(buttonLook(variant, "disabled", false).labelTone).toBe("tertiary");
    }
    expect(colorOf(fillOf(buttonLook("primary", "disabled", false).container)!)).toBe(
      colors.surfaceHigh,
    );
  });

  it("is 48 px tall at least, radius lg, with a 1 px border on every variant so sizes never jump", () => {
    for (const variant of VARIANTS) {
      for (const state of STATES) {
        const classes = classesOf(buttonLook(variant, state, false).container);
        expect(classes).toEqual(
          expect.arrayContaining(["min-h-12", "rounded-lg", "border"]),
        );
      }
    }
  });

  it("secondary and ghost labels read at least 4.5:1 on the canvas and when pressed", () => {
    for (const variant of ["secondary", "ghost"] as const) {
      for (const state of ["idle", "pressed"] as const) {
        const look = buttonLook(variant, state, false);
        const fill = colorOf(fillOf(look.container)!) ?? colors.canvas; // transparent: the canvas shows through
        expect(
          contrast(toneColor(look.labelTone), fill),
          `${variant}/${state}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("is as wide as its label, or the full width when asked", () => {
    expect(buttonLook("primary", "idle", false).container).toContain("self-start");
    expect(buttonLook("primary", "idle", true).container).toContain("self-stretch");
  });

  it("shows a spinner that can be seen on its own fill", () => {
    expect(buttonLook("primary", "idle", false).spinnerColor).toBe("contentInverse");
    expect(buttonLook("secondary", "idle", false).spinnerColor).toBe("contentPrimary");
  });
});

describe("Input", () => {
  it("is a recessed field with a hairline border, and the focus ring is Ember", () => {
    expect(inputClasses("idle")).toContain("bg-surface-lowest");
    expect(inputClasses("idle")).toContain("border-line-subtle");
    expect(inputClasses("focused")).toContain("border-line-focus");
    expect(colors.lineFocus).toBe(colors.ember);
    expect(inputClasses("error")).toContain("border-error");
  });

  it("lets a tap anywhere on the box focus the field: the text field itself is the 48 px box", () => {
    expect(classesOf(INPUT_TEXT_CLASS)).toEqual(
      expect.arrayContaining(["min-h-12", "px-4"]),
    );
    for (const state of INPUT_STATES) {
      expect(classesOf(inputClasses(state))).not.toContain("px-4"); // no dead padding around the field
    }
  });

  it("shows exactly one border color per state", () => {
    for (const state of INPUT_STATES) {
      expect(
        classesOf(inputClasses(state)).filter((c) => c.startsWith("border-")),
      ).toHaveLength(1);
    }
  });

  it("an error wins over focus; focus wins over rest", () => {
    expect(resolveInputState(true, true)).toBe("error");
    expect(resolveInputState(false, true)).toBe("error");
    expect(resolveInputState(true, false)).toBe("focused");
    expect(resolveInputState(false, false)).toBe("idle");
  });

  it("placeholder, typed text and label are readable on the input fill (placeholder needs its own token)", () => {
    const fill = colors.surfaceLowest;
    expect(contrast(colors.contentPlaceholder, fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.contentPrimary, fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.contentSecondary, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.error, colors.canvas)).toBeGreaterThanOrEqual(4.5); // the error message sits on the canvas
  });
});

describe("Card", () => {
  it("separates levels with surface tiers", () => {
    expect(cardClasses("low")).toContain("bg-surface-low");
    expect(cardClasses("elevated")).toContain("bg-surface-elevated");
    expect(cardClasses("selected")).toContain("bg-surface-high");
  });

  it("has radius xl, a hairline border and padding, and no shadow", () => {
    for (const tone of CARD_TONES) {
      const classes = classesOf(cardClasses(tone));
      expect(classes).toEqual(
        expect.arrayContaining(["rounded-xl", "border", "border-line-subtle", "p-4"]),
      );
      expect(classes.some((c) => c.startsWith("shadow"))).toBe(false);
    }
  });
});

describe("Badge", () => {
  it("puts the inverse color on every bright fill, and it reads at least 4.5:1", () => {
    for (const tone of BADGE_TONES.filter((t) => t !== "neutral")) {
      const look = badgeLook(tone);
      expect(look.labelTone, tone).toBe("inverse");
      expect(
        contrast(toneColor(look.labelTone), colorOf(fillOf(look.container)!)!),
        tone,
      ).toBeGreaterThanOrEqual(4.5);
    }
    const neutral = badgeLook("neutral");
    expect(
      contrast(toneColor(neutral.labelTone), colorOf(fillOf(neutral.container)!)!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("is a pill", () => {
    for (const tone of BADGE_TONES)
      expect(badgeLook(tone).container).toContain("rounded-full");
  });

  it("uses the feedback colors for their fixed meanings", () => {
    expect(colorOf(fillOf(badgeLook("success").container)!)).toBe(colors.success);
    expect(colorOf(fillOf(badgeLook("warning").container)!)).toBe(colors.warning);
    expect(colorOf(fillOf(badgeLook("error").container)!)).toBe(colors.error);
  });
});

describe("Chartreuse is reserved for live / realtime (DESIGN.md rule 4)", () => {
  it("appears only in the live badge, in no other component and no other state", () => {
    const users: string[] = [];
    const note = (source: string, classes: string) => {
      if (classesOf(classes).some((c) => colorOf(c) === colors.chartreuse))
        users.push(source);
    };
    for (const variant of VARIANTS)
      for (const state of STATES)
        note(`button ${variant}/${state}`, buttonLook(variant, state, false).container);
    for (const state of INPUT_STATES) note(`input ${state}`, inputClasses(state));
    for (const tone of CARD_TONES) note(`card ${tone}`, cardClasses(tone));
    for (const tone of BADGE_TONES) note(`badge ${tone}`, badgeLook(tone).container);
    for (const tone of Object.keys(TEXT_TONE_CLASS) as TextTone[])
      note(`text ${tone}`, TEXT_TONE_CLASS[tone]);

    expect(users).toEqual(["badge live"]);
  });
});

describe("no shadows (DESIGN.md rule 2: depth is surface tiers)", () => {
  const files = ["src/components", "src/dev", "src/app/(auth)", "src/app/(app)"].flatMap(
    (dir) => {
      const walk = (path: string): string[] =>
        readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(join(path, entry.name))
            : /\.tsx?$/.test(entry.name)
              ? [join(path, entry.name)]
              : [],
        );
      return walk(join(mobile, dir));
    },
  );

  it("finds the files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("uses no shadow or elevation style property", () => {
    const style =
      /\b(shadowColor|shadowOffset|shadowOpacity|shadowRadius|elevation)\b\s*[:=]/;

    expect(files.filter((file) => style.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("uses no shadow class", () => {
    const offenders = files.filter((file) =>
      [
        ...readFileSync(file, "utf8").matchAll(/[cC]lassName=\{?(["'])([^"'`{}$]+)\1/g),
      ].some((match) => match[2]!.split(/\s+/).some((cls) => cls.startsWith("shadow"))),
    );

    expect(offenders).toEqual([]);
    for (const tone of CARD_TONES) {
      expect(classesOf(cardClasses(tone)).some((cls) => cls.startsWith("shadow"))).toBe(
        false,
      );
    }
  });
});

describe("navigation follows the design system", () => {
  it("draws every screen and header on the canvas, with hairline borders and primary text", () => {
    expect(navigationColors.background).toBe(colors.canvas);
    expect(navigationColors.card).toBe(colors.canvas);
    expect(navigationColors.text).toBe(colors.contentPrimary);
    expect(navigationColors.border).toBe(colors.lineSubtle);
  });

  it("does not make Ember the navigation highlight (Ember is the one main action of a screen)", () => {
    expect(navigationColors.primary).not.toBe(colors.ember);
    expect(navigationColors.primary).toBe(colors.contentPrimary);
  });
});

describe("app configuration", () => {
  const config = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8")).expo;

  it("is dark only", () => {
    expect(config.userInterfaceStyle).toBe("dark");
  });

  it("shows the splash screen on the canvas color", () => {
    const splash = config.plugins.find(
      (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
    );

    expect(splash[1].backgroundColor.toLowerCase()).toBe(colors.canvas.toLowerCase());
  });
});
