/// <reference types="node" />
// Node types for this file only: TypeScript 6 does not load @types automatically, and the app code
// must not see Node globals.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";
import { badgeLook, type BadgeTone } from "@/components/badge-styles";
import {
  BUTTON_LABEL_HIDDEN,
  BUTTON_SPINNER_LAYER,
  buttonContentClass,
  buttonLook,
  type ButtonState,
  type ButtonVariant,
} from "@/components/button-styles";
import { cardClasses, type CardTone } from "@/components/card-styles";
import {
  INPUT_FIELD_CLASS,
  INPUT_TEXT_CLASS,
  inputClasses,
  type InputState,
} from "@/components/input-styles";
import { TEXT_TONE_CLASS } from "@/components/text-styles";
import {
  TRACK_COVER_CLASS,
  TRACK_ROW_CLASS,
  TRACK_TEXT_CLASS,
  voteLook,
} from "@/components/track-row-styles";

// A class that Tailwind does not know renders NOTHING in React Native, with no error: a typo in
// "bg-ember" would just draw a transparent button. So every class the app uses is compiled with the
// real stylesheet (the design tokens, with Tailwind's default palette removed) and must come out.

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

/** Classes written directly in className="..." / contentContainerClassName="..." in the screens and components. */
function classesInSource(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(join(mobile, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/[cC]lassName=\{?(["'])([^"'`{}$]+)\1/g)) {
      for (const cls of match[2]!.split(/\s+/).filter(Boolean)) found.add(cls);
    }
  }
  return [...found];
}

/** Classes the style modules build for every variant and state. */
function classesFromStyles(): string[] {
  const all: string[] = [
    BUTTON_LABEL_HIDDEN,
    BUTTON_SPINNER_LAYER,
    buttonContentClass(false),
    buttonContentClass(true),
    INPUT_FIELD_CLASS,
    INPUT_TEXT_CLASS,
    ...Object.values(TEXT_TONE_CLASS),
    TRACK_ROW_CLASS,
    TRACK_COVER_CLASS,
    TRACK_TEXT_CLASS,
    voteLook(true, false).container,
    voteLook(false, false).container,
    voteLook(false, true).container,
  ];
  for (const variant of ["primary", "secondary", "ghost"] as ButtonVariant[]) {
    for (const state of ["idle", "pressed", "disabled"] as ButtonState[]) {
      for (const full of [false, true])
        all.push(buttonLook(variant, state, full).container);
    }
  }
  for (const state of ["idle", "focused", "error"] as InputState[])
    all.push(inputClasses(state));
  for (const tone of ["low", "elevated", "selected"] as CardTone[])
    all.push(cardClasses(tone));
  for (const tone of [
    "neutral",
    "accent",
    "live",
    "success",
    "warning",
    "error",
  ] as BadgeTone[])
    all.push(badgeLook(tone).container);
  return all.flatMap((value) => value.split(/\s+/).filter(Boolean));
}

async function compile(classes: string[]): Promise<string> {
  const css =
    readFileSync(join(mobile, "src", "global.css"), "utf8") +
    `\n@source inline("${classes.join(" ")}");\n`;
  const result = await postcss([tailwind({ base: mobile })]).process(css, {
    from: join(mobile, "src", "global.css"),
  });
  return result.css;
}

// Tailwind writes a dot in a class name as `\\.` in the stylesheet (gap-1.5 becomes .gap-1\\.5).
const cssSelector = (cls: string) => `.${cls.replace(/[.:/[\]]/g, "\\$&")}`;
const defined = (css: string, cls: string) =>
  new RegExp(
    `${cssSelector(cls).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s{,:>.\\[])`,
  ).test(css);

describe("every class the app uses exists in the compiled stylesheet", () => {
  const classes = [...new Set([...classesInSource(), ...classesFromStyles()])].sort();

  it("finds the classes (so the test cannot pass by scanning nothing)", () => {
    expect(classes.length).toBeGreaterThan(40);
    expect(classes).toEqual(
      expect.arrayContaining([
        "bg-ember",
        "bg-canvas",
        "text-content-primary",
        "rounded-lg",
        "min-h-12",
      ]),
    );
  });

  it("compiles every one of them", async () => {
    const css = await compile(classes);

    const missing = classes.filter((cls) => !defined(css, cls));

    expect(missing).toEqual([]);
  }, 30_000);

  it("rejects what the design system removed: the default palette, sizes and radii", async () => {
    const css = await compile([
      "bg-red-500",
      "text-white",
      "text-lg",
      "rounded-3xl",
      "bg-ember",
    ]);

    expect(defined(css, "bg-ember")).toBe(true);
    for (const gone of ["bg-red-500", "text-white", "text-lg", "rounded-3xl"])
      expect(defined(css, gone), gone).toBe(false);
  }, 30_000);
});
