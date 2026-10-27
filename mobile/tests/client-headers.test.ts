import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-device", () => ({ modelName: null }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

const { browserDeviceName } = await import("@/api/client-headers");

// On the web the browser stands in for the device model in the backend's logs (ADR-050).
describe("the device name sent from a browser", () => {
  it.each([
    [
      "Chrome on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ],
    [
      "Safari on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    ],
    [
      "Firefox on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    ],
    [
      "Opera on Linux",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
    ],
    [
      "Safari on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Chrome on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Chrome on ChromeOS",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ],
  ])("%s", (expected, userAgent) => {
    expect(browserDeviceName(userAgent)).toBe(expected);
  });

  it("names what it can when only one part is known, and never sends an empty name", () => {
    expect(browserDeviceName("SomeBot/1.0 (Windows NT 10.0)")).toBe("Windows");
    expect(browserDeviceName("")).toBe("Web browser");
  });

  it("only ever produces characters the backend keeps in its logs", () => {
    expect(browserDeviceName("Firefox/1 (Windows)")).toMatch(/^[\p{L}\p{N} ._+\-()]+$/u);
  });
});
