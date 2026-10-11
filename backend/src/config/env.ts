import { z } from "zod";

// Every environment variable the backend reads is declared here, once.
// Missing or malformed values make startup fail immediately with a clear
// message, instead of surfacing later as a confusing runtime error.
// A line like `FACEBOOK_APP_ID=` in .env (as in .env.example) means "not set".
const blankToUndefined = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.trim() === "" ? undefined : value.trim(),
  );

// One browser origin: scheme + host (+ port), nothing else. "*" and URLs with a
// path or trailing slash are rejected, because a wrong value here fails open or
// silently never matches.
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && url.origin === value
    );
  } catch {
    return false;
  }
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    // Signs access tokens (HS256). 32+ characters so it cannot be brute-forced; never commit a real one.
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    // Social sign-in (ADR-011). All optional: a provider without its settings is
    // simply disabled (its endpoint answers 502 PROVIDER_UNAVAILABLE).
    // Comma-separated OAuth client ids (iOS, Android, Web) accepted as the Google token audience.
    GOOGLE_CLIENT_IDS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== ""),
      ),
    // Browser origins allowed to call the API (web client), comma-separated, e.g.
    // http://localhost:8081. Empty means no browser origin is allowed; the mobile
    // app is not a browser and is not affected.
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin !== ""),
      )
      .refine((origins) => origins.every(isOrigin), {
        message:
          'ALLOWED_ORIGINS must be comma-separated origins like "https://app.example.com" (no "*", path or trailing slash)',
      }),
    FACEBOOK_APP_ID: blankToUndefined,
    // Server-side only: never sent to the app, never committed.
    FACEBOOK_APP_SECRET: blankToUndefined,
  })
  .refine(
    (env) =>
      (env.FACEBOOK_APP_ID === undefined) === (env.FACEBOOK_APP_SECRET === undefined),
    {
      message: "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set together",
      path: ["FACEBOOK_APP_SECRET"],
    },
  );

export type Config = z.infer<typeof envSchema>;

/**
 * Validates an environment object and returns typed config.
 * Takes the env as a parameter (instead of reading process.env directly) so
 * tests can pass any values without touching global state.
 * @throws Error listing every invalid or missing variable.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/**
 * Loads the repo-root .env file (shared with docker-compose) into process.env.
 * Variables already set in the real environment win over the file, which is
 * what CI and production rely on. A missing file is fine for the same reason.
 */
export function loadEnvFileIfPresent(): void {
  try {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
