import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Vitest's default is 5 seconds. The integration tests run in parallel (one worker per
    // file) against ONE Postgres, and several fire 20 to 30 requests at once. A test that
    // takes 0.6 s alone can take several seconds when the whole suite runs on a busy
    // machine, which made the suite fail at random. A real deadlock or hang still fails,
    // after 20 s; the unit tests finish in milliseconds either way.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
