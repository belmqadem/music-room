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
    // At most 4 test files at a time. The default is one worker per CPU, and 37 files then hit
    // ONE Postgres (in a small Docker VM) together: on a busy 10-CPU machine about 1 run in 8
    // failed at random, and with 4 workers none of 24 did. Each test still creates its own
    // concurrency (Promise.all), so the race tests are not weakened. A CI runner has 4 CPUs.
    maxWorkers: 4,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
