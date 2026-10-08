import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
  it("applies defaults for optional variables", () => {
    const config = loadConfig(validEnv);

    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe("development");
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("coerces PORT from a string to a number", () => {
    expect(loadConfig({ ...validEnv, PORT: "4010" }).PORT).toBe(4010);
  });

  it("fails fast and names every missing required variable", () => {
    expect(() => loadConfig({})).toThrowError(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrowError(/PORT/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: "loud" })).toThrowError(
      /LOG_LEVEL/,
    );
  });
});
