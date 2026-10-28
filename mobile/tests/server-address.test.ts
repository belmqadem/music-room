import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeServerAddress,
  checkServer,
  normalizeBackendUrl,
} from "@/settings/server-address";

describe("the server address", () => {
  it.each([
    ["http://192.168.1.20:3000", "http://192.168.1.20:3000"],
    ["  http://192.168.1.20:3000/  ", "http://192.168.1.20:3000"],
    ["https://music.example.com", "https://music.example.com"],
    ["http://10.0.2.2:3000///", "http://10.0.2.2:3000"],
  ])("%j is kept as %j", (input, normalized) => {
    expect(normalizeBackendUrl(input)).toBe(normalized);
  });

  it.each(["", "192.168.1.20:3000", "ftp://host", "not a url", "javascript:alert(1)"])(
    "%j is refused",
    (input) => {
      expect(() => normalizeBackendUrl(input)).toThrow();
    },
  );
});

describe("checking the server before using it", () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;

  it("asks <address>/health", async () => {
    const fetchFn = answer(200, { status: "ok" });

    await checkServer("http://10.0.2.2:3000", fetchFn);

    expect(fetchFn).toHaveBeenCalledWith(
      "http://10.0.2.2:3000/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("a Music Room backend: reachable", async () => {
    expect(await checkServer("http://h", answer(200, { status: "ok" }))).toBe(
      "reachable",
    );
  });

  it.each([
    ["another JSON", 200, { hello: "world" }],
    ["an error page", 404, { error: "x" }],
    ["a server error", 500, {}],
    // An error status is never "reachable", even with the right body (a proxy in front of a broken server).
    ["an error status saying ok", 503, { status: "ok" }],
  ])("%s: something answered, but not Music Room", async (_label, status, body) => {
    expect(await checkServer("http://h", answer(status, body))).toBe("not_music_room");
  });

  it("an answer that is not JSON: not Music Room", async () => {
    const html = vi.fn(async () => new Response("<html></html>", { status: 200 }));

    expect(await checkServer("http://h", html as unknown as typeof fetch)).toBe(
      "not_music_room",
    );
  });

  it("nothing answers (network error): unreachable", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });

    expect(await checkServer("http://h", down as unknown as typeof fetch)).toBe(
      "unreachable",
    );
  });

  describe("an address that never answers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("gives up after the time limit: unreachable", async () => {
      const hangs = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      );
      const result = checkServer("http://h", hangs as unknown as typeof fetch, 5_000);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(await result).toBe("unreachable");
    });
  });
});

describe("changing the server address (the old server's session never goes to the new one)", () => {
  function change(current: string, opts: { forgetFails?: boolean } = {}) {
    const events: string[] = [];
    const deps = {
      current: async () => current,
      forgetStoredSession: async () => {
        events.push("forget session");
        if (opts.forgetFails) throw new Error("storage clear failed");
      },
      store: async () => {
        events.push("store address");
      },
    };
    return { events, deps };
  }

  it("a different address: the stored session is forgotten BEFORE the address is stored", async () => {
    const { events, deps } = change("http://10.0.2.2:3000");

    await changeServerAddress("http://192.168.1.20:3000", deps);

    expect(events).toEqual(["forget session", "store address"]);
  });

  it("when the session cannot be forgotten: the address is NOT changed, and the error is raised", async () => {
    const { events, deps } = change("http://10.0.2.2:3000", { forgetFails: true });

    await expect(changeServerAddress("http://192.168.1.20:3000", deps)).rejects.toThrow(
      "storage clear failed",
    );
    expect(events).toEqual(["forget session"]);
  });

  it("the address already in use: the session is kept", async () => {
    const { events, deps } = change("http://10.0.2.2:3000");

    await changeServerAddress("http://10.0.2.2:3000", deps);

    expect(events).toEqual(["store address"]);
  });
});
