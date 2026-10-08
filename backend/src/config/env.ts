import { z } from "zod";

// Every environment variable the backend reads is declared here, once.
// Missing or malformed values make startup fail immediately with a clear
// message, instead of surfacing later as a confusing runtime error.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
});

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
