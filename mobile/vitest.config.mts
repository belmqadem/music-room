import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests for the app's plain-TypeScript logic (API client, auth). Screens are not tested here.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
