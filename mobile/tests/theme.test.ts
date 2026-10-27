/// <reference types="node" />
// Node types for this file only: TypeScript 6 does not load @types automatically, and the app code
// must not see Node globals.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateTheme } from "../scripts/generate-theme.mjs";

// The theme is generated from design-tokens.json (ADR-029). These tests keep the generated files
// honest and enforce the rule in CLAUDE.md: no hardcoded colors in the app.

const mobile = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(mobile, "..");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const tokens = readJson(join(root, "design-tokens.json"));
const extensions = readJson(join(root, "design-tokens.extensions.json"));
const theme = generateTheme(tokens, extensions);

/** A copy of the tokens with one change, so a test can break exactly one rule. */
function withTokens(change: (copy: typeof tokens) => void) {
  const copy = structuredClone(tokens);
  change(copy);
  return copy;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("the generated files", () => {
  it.each(Object.keys(theme.files))(
    "%s is exactly what the generator writes now (run `make theme` if not)",
    (name) => {
      const onDisk = readFileSync(join(mobile, "src", "theme", name), "utf8");

      expect(onDisk).toBe(theme.files[name]);
    },
  );

  it("is deterministic", () => {
    expect(generateTheme(tokens, extensions).files).toEqual(theme.files);
  });
});

describe("what the tokens become", () => {
  it("carries every color of the export, with its value, plus ours", () => {
    const exported = Object.values(
      tokens.colors as Record<string, Record<string, { value: string }>>,
    ).flatMap((group) => Object.values(group).map((token) => token.value));

    for (const value of exported) expect(Object.values(theme.colors)).toContain(value);
    expect(Object.keys(theme.colors)).toHaveLength(exported.length + 1);
  });

  it("adds text.placeholder, which reads at least 4.5:1 on the input fill (text.tertiary does not)", () => {
    expect(theme.colors["contentPlaceholder"]).toBe("#757B8B");
    expect(
      contrast(theme.colors["contentPlaceholder"]!, theme.colors["surfaceLowest"]!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(theme.colors["contentTertiary"]!, theme.colors["surfaceLowest"]!),
    ).toBeLessThan(4.5);
  });

  it("keeps Ember the only primary accent and checks inverse text on the bright fills", () => {
    expect(
      contrast(theme.colors["contentInverse"]!, theme.colors["ember"]!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(theme.colors["contentInverse"]!, theme.colors["chartreuse"]!),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("adds the app's column width, a number in pixels (ADR-050)", () => {
    expect(theme.maxWidth).toEqual({ content: 640 });
  });

  it("turns radii into numbers", () => {
    expect(theme.radius).toEqual({ sm: 6, md: 8, lg: 12, xl: 16, "2xl": 20, full: 9999 });
  });

  it("turns the em letter spacing into pixels, as React Native needs", () => {
    expect(theme.typography["hero"]!.letterSpacing).toBe(-0.96); // -0.03em of 32
    expect(theme.typography["h1"]!.letterSpacing).toBe(-0.52);
    expect(theme.typography["badge"]!.letterSpacing).toBe(0.44);
    expect(theme.typography["code"]!.letterSpacing).toBe(1.44);
    expect(theme.typography["body"]!.letterSpacing).toBe(0);
  });

  it("uppercases only the badge", () => {
    const upper = Object.entries(theme.typography).filter(
      ([, s]) => s.textTransform === "uppercase",
    );

    expect(upper.map(([variant]) => variant)).toEqual(["badge"]);
  });

  it("names each font file the way expo-google-fonts does, one per declared weight", () => {
    expect(theme.fonts["display"]!.loaded).toEqual({
      "700": "Syne_700Bold",
      "800": "Syne_800ExtraBold",
    });
    expect(theme.fonts["sans"]!.loaded["600"]).toBe("PlusJakartaSans_600SemiBold");
    expect(theme.fonts["mono"]!.loaded).toEqual({
      "500": "JetBrainsMono_500Medium",
      "700": "JetBrainsMono_700Bold",
    });
    expect(theme.fonts["sans"]!.pkg).toBe("@expo-google-fonts/plus-jakarta-sans");
  });

  it("gives every text style a font file that is actually loaded", () => {
    const loaded = Object.values(theme.fonts).flatMap((role) =>
      Object.values(role.loaded),
    );
    const fontsFile = theme.files["fonts.generated.ts"]!;

    for (const style of Object.values(theme.typography)) {
      expect(loaded).toContain(style.fontFamily);
      expect(fontsFile).toContain(`import { ${style.fontFamily} } from`);
    }
  });

  it("imports each weight from its own folder, so unused weights are not bundled", () => {
    const fontsFile = theme.files["fonts.generated.ts"]!;

    expect(fontsFile).toContain('from "@expo-google-fonts/syne/800ExtraBold"');
    expect(fontsFile).not.toMatch(/from "@expo-google-fonts\/[a-z-]+"/);
  });

  it("exposes the tokens to className and removes Tailwind's default palette, radii, fonts and sizes", () => {
    const css = theme.files["theme.generated.css"]!;

    for (const reset of [
      "--color-*: initial;",
      "--radius-*: initial;",
      "--container-*: initial;",
      "--font-*: initial;",
      "--text-*: initial;",
    ]) {
      expect(css).toContain(reset);
    }
    expect(css).toContain("--color-ember: #FF5A36;");
    expect(css).toContain("--color-line-subtle: rgba(255, 255, 255, 0.08);");
    expect(css).toContain("--radius-2xl: 20px;");
    expect(css).toContain("--container-content: 640px;");
    expect(css).toContain("--font-sans-600: PlusJakartaSans_600SemiBold;");
    expect(css).toContain("--text-hero--letter-spacing: -0.96px;");
    // One variable per token; the `--color-*: initial` reset has a star and is not counted.
    expect(css.match(/--color-[a-z-]+:/g)).toHaveLength(Object.keys(theme.colors).length);
  });
});

describe("the generator refuses what it cannot translate", () => {
  it("a max width that is not in pixels", () => {
    const inRem = { maxWidth: { content: { value: "40rem", description: "x" } } };

    expect(() => generateTheme(tokens, inRem)).toThrow(/maxWidth\.content/);
  });

  it("a token in our extensions that already exists in the export", () => {
    const clash = {
      colors: { text: { primary: { value: "#FFFFFF", description: "x" } } },
    };

    expect(() => generateTheme(tokens, clash)).toThrow(/already exists/);
  });

  it("a color it has no name for (so nobody names one by accident)", () => {
    const extra = { colors: { brand: { neon: { value: "#00FF00", description: "x" } } } };

    expect(() => generateTheme(tokens, extra)).toThrow(
      /No theme name for color brand\.neon/,
    );
  });

  it.each(["red", "#FFF", "#GG0000", "hsl(0,0%,0%)"])(
    "a color value it cannot read (%s)",
    (value) => {
      const bad = withTokens((t) => {
        t.colors.brand.chartreuse.value = value;
      });

      expect(() => generateTheme(bad, extensions)).toThrow(/unsupported color/);
    },
  );

  it("a text style using a weight its font family does not declare", () => {
    const bad = withTokens((t) => {
      t.typography.scale.h2.fontWeight = "500"; // display has only 700 and 800
      t.typography.scale.h2.fontFamily = "display";
    });

    expect(() => generateTheme(bad, extensions)).toThrow(/display has no weight 500/);
  });

  it("a text style using an unknown font family", () => {
    const bad = withTokens((t) => {
      t.typography.scale.h2.fontFamily = "script";
    });

    expect(() => generateTheme(bad, extensions)).toThrow(/unknown fontFamily/);
  });

  it("a font weight it has no file name for", () => {
    const bad = withTokens((t) => {
      t.typography.fontFamilies.sans.weights.push("550");
    });

    expect(() => generateTheme(bad, extensions)).toThrow(/no name known for weight 550/);
  });

  it("sizes and spacing in the wrong unit", () => {
    const badSize = withTokens((t) => {
      t.typography.scale.body.fontSize = "1rem";
    });
    const badSpacing = withTokens((t) => {
      t.typography.scale.body.letterSpacing = "2px";
    });
    const badRadius = withTokens((t) => {
      t.borderRadius.md = "50%";
    });

    expect(() => generateTheme(badSize, extensions)).toThrow(/expected a size/);
    expect(() => generateTheme(badSpacing, extensions)).toThrow(/letterSpacing/);
    expect(() => generateTheme(badRadius, extensions)).toThrow(/borderRadius\.md/);
  });

  it("a light color mode (the app is dark only)", () => {
    const bad = withTokens((t) => {
      t.colorMode = "light";
    });

    expect(() => generateTheme(bad, extensions)).toThrow(/dark/);
  });
});

describe("no hardcoded colors in the app (CLAUDE.md)", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx|css)$/.test(entry) && !/\.generated\./.test(entry) ? [path] : [];
    });
  }

  it("finds no #hex, rgb(), rgba(), hsl() or hsla() outside the generated theme", () => {
    const offenders = sourceFiles(join(mobile, "src")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const found = text.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/g);
      return found ? [`${relative(mobile, file)}: ${found.join(", ")}`] : [];
    });

    expect(offenders).toEqual([]);
  });
});
