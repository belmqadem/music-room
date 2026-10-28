import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "x".repeat(32),
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

  it("rejects a JWT secret shorter than 32 characters", () => {
    expect(() => loadConfig({ ...validEnv, JWT_ACCESS_SECRET: "short" })).toThrowError(
      /JWT_ACCESS_SECRET/,
    );
  });

  it("rejects the placeholder secret that .env.example ships with", () => {
    const placeholder = "replace-me-with-at-least-32-random-characters";
    expect(placeholder.length).toBeGreaterThanOrEqual(32); // long enough to pass the length rule
    expect(() =>
      loadConfig({ ...validEnv, JWT_ACCESS_SECRET: placeholder }),
    ).toThrowError(/placeholder/);
  });

  it("accepts a real secret even if it contains the words of the placeholder later on", () => {
    const secret = "a1b2c3d4e5f6a7b8-replace-me-9f8e7d6c5b4a3210";
    expect(loadConfig({ ...validEnv, JWT_ACCESS_SECRET: secret }).JWT_ACCESS_SECRET).toBe(
      secret,
    );
  });

  it("does not leak the secret value in the error message", () => {
    expect(() =>
      loadConfig({ ...validEnv, JWT_ACCESS_SECRET: "short-secret-value" }),
    ).not.toThrowError(/short-secret-value/);
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => loadConfig({ ...validEnv, PORT: "70000" })).toThrowError(/PORT/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: "loud" })).toThrowError(
      /LOG_LEVEL/,
    );
  });

  describe("social sign-in settings", () => {
    it("are optional: no providers configured is valid", () => {
      const config = loadConfig(validEnv);

      expect(config.GOOGLE_CLIENT_IDS).toEqual([]);
      expect(config.FACEBOOK_APP_ID).toBeUndefined();
      expect(config.FACEBOOK_APP_SECRET).toBeUndefined();
    });

    it("splits GOOGLE_CLIENT_IDS on commas and ignores spaces and empty items", () => {
      const config = loadConfig({
        ...validEnv,
        GOOGLE_CLIENT_IDS: " ios-id , android-id,, ",
      });

      expect(config.GOOGLE_CLIENT_IDS).toEqual(["ios-id", "android-id"]);
    });

    it("treats a blank GOOGLE_CLIENT_IDS (as in .env.example) as not configured", () => {
      expect(
        loadConfig({ ...validEnv, GOOGLE_CLIENT_IDS: "" }).GOOGLE_CLIENT_IDS,
      ).toEqual([]);
    });

    it("treats the blank Facebook lines of .env.example as not configured", () => {
      const config = loadConfig({
        ...validEnv,
        FACEBOOK_APP_ID: "",
        FACEBOOK_APP_SECRET: "",
      });

      expect(config.FACEBOOK_APP_ID).toBeUndefined();
      expect(config.FACEBOOK_APP_SECRET).toBeUndefined();
    });

    it("requires the Facebook app id and secret together", () => {
      expect(() => loadConfig({ ...validEnv, FACEBOOK_APP_ID: "123" })).toThrowError(
        /FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set together/,
      );
      expect(() => loadConfig({ ...validEnv, FACEBOOK_APP_SECRET: "s" })).toThrowError(
        /must be set together/,
      );
      expect(
        loadConfig({ ...validEnv, FACEBOOK_APP_ID: "123", FACEBOOK_APP_SECRET: "s" }),
      ).toMatchObject({ FACEBOOK_APP_ID: "123", FACEBOOK_APP_SECRET: "s" });
    });
  });

  describe("ALLOWED_ORIGINS", () => {
    it("defaults to no origin at all", () => {
      expect(loadConfig(validEnv).ALLOWED_ORIGINS).toEqual([]);
      expect(loadConfig({ ...validEnv, ALLOWED_ORIGINS: "" }).ALLOWED_ORIGINS).toEqual(
        [],
      );
    });

    it("splits on commas and ignores spaces and empty items", () => {
      const config = loadConfig({
        ...validEnv,
        ALLOWED_ORIGINS: " http://localhost:8081 , https://app.example.com,, ",
      });

      expect(config.ALLOWED_ORIGINS).toEqual([
        "http://localhost:8081",
        "https://app.example.com",
      ]);
    });

    it.each([
      ["a wildcard", "*"],
      ["a trailing slash", "http://localhost:8081/"],
      ["a path", "https://app.example.com/app"],
      ["a missing scheme", "localhost:8081"],
      ["another scheme", "ftp://example.com"],
      ["one bad entry among good ones", "http://localhost:8081,*"],
    ])("rejects %s", (_label, value) => {
      expect(() => loadConfig({ ...validEnv, ALLOWED_ORIGINS: value })).toThrowError(
        /ALLOWED_ORIGINS/,
      );
    });
  });

  describe("TRUST_PROXY and CATALOG_PROVIDER", () => {
    it("default to trusting no proxy and the real catalog", () => {
      const config = loadConfig(validEnv);

      expect(config.TRUST_PROXY).toBe(0);
      expect(config.CATALOG_PROVIDER).toBe("deezer");
    });

    it("read the number of proxies from a string", () => {
      expect(loadConfig({ ...validEnv, TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    });

    it.each(["-1", "11", "1.5", "yes", ""])(
      "reject the TRUST_PROXY value %j",
      (value) => {
        // An empty string coerces to 0, which is a valid (and safe) value.
        if (value === "") {
          expect(loadConfig({ ...validEnv, TRUST_PROXY: value }).TRUST_PROXY).toBe(0);
          return;
        }
        expect(() => loadConfig({ ...validEnv, TRUST_PROXY: value })).toThrowError(
          /TRUST_PROXY/,
        );
      },
    );

    it("accept the fake catalog outside production", () => {
      for (const NODE_ENV of ["development", "test"]) {
        expect(
          loadConfig({ ...validEnv, NODE_ENV, CATALOG_PROVIDER: "fake" })
            .CATALOG_PROVIDER,
        ).toBe("fake");
      }
    });

    it("refuse the fake catalog in production", () => {
      expect(() =>
        loadConfig({ ...validEnv, NODE_ENV: "production", CATALOG_PROVIDER: "fake" }),
      ).toThrowError(/CATALOG_PROVIDER=fake is for load tests/);
    });

    it("reject an unknown catalog name", () => {
      expect(() => loadConfig({ ...validEnv, CATALOG_PROVIDER: "spotify" })).toThrowError(
        /CATALOG_PROVIDER/,
      );
    });
  });

  describe("email settings", () => {
    it("defaults to the console mailer", () => {
      const config = loadConfig(validEnv);

      expect(config.MAIL_TRANSPORT).toBe("console");
      expect(config.SMTP_URL).toBeUndefined();
    });

    it("needs SMTP_URL when the transport is smtp", () => {
      expect(() => loadConfig({ ...validEnv, MAIL_TRANSPORT: "smtp" })).toThrowError(
        /SMTP_URL/,
      );
      expect(() =>
        loadConfig({ ...validEnv, MAIL_TRANSPORT: "smtp", SMTP_URL: "  " }),
      ).toThrowError(/SMTP_URL/);
      expect(
        loadConfig({
          ...validEnv,
          MAIL_TRANSPORT: "smtp",
          SMTP_URL: "smtp://localhost:1025",
        }).SMTP_URL,
      ).toBe("smtp://localhost:1025");
    });

    it("refuses the console mailer in production, because it prints the codes", () => {
      expect(() => loadConfig({ ...validEnv, NODE_ENV: "production" })).toThrowError(
        /MAIL_TRANSPORT=console/,
      );
      expect(
        loadConfig({
          ...validEnv,
          NODE_ENV: "production",
          MAIL_TRANSPORT: "smtp",
          SMTP_URL: "smtps://u:p@mail.example.com:465",
        }).MAIL_TRANSPORT,
      ).toBe("smtp");
    });

    it("rejects an unknown transport", () => {
      expect(() =>
        loadConfig({ ...validEnv, MAIL_TRANSPORT: "carrier-pigeon" }),
      ).toThrowError(/MAIL_TRANSPORT/);
    });
  });
});
