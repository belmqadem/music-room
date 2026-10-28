// Types for scripts/generate-theme.mjs, so the tests (TypeScript) can import it.
export interface GeneratedTheme {
  colorMode: string;
  colors: Record<string, string>;
  radius: Record<string, number>;
  maxWidth: Record<string, number>;
  fonts: Record<string, { pkg: string; loaded: Record<string, string> }>;
  typography: Record<
    string,
    {
      fontFamily: string;
      fontSize: number;
      lineHeight: number;
      letterSpacing: number;
      textTransform?: "uppercase";
    }
  >;
  files: Record<string, string>;
}

export function generateTheme(tokens: unknown, extensions?: unknown): GeneratedTheme;
