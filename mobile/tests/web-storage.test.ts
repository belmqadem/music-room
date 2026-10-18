import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebRefreshLock, createWebStorage } from "@/auth/web-storage";

function memoryStorage(failing = false) {
  const data = new Map<string, string>();
  const fail = () => {
    if (failing) throw new Error("blocked");
  };
  return {
    data,
    getItem: (key: string) => (fail(), data.get(key) ?? null),
    setItem: (key: string, value: string) => (fail(), void data.set(key, value)),
    removeItem: (key: string) => (fail(), void data.delete(key)),
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("refresh token in browser storage", () => {
  it("saves, reads and deletes the token in the shared storage", async () => {
    const backing = memoryStorage();
    const storage = createWebStorage(backing);

    expect(await storage.get()).toBeNull();
    await storage.set("token-1");
    expect(await storage.get()).toBe("token-1");
    expect([...backing.data.values()]).toEqual(["token-1"]);
    await storage.clear();
    expect(await storage.get()).toBeNull();
    expect(backing.data.size).toBe(0);
  });

  it("sees a token written by another tab (that is what the shared storage is for)", async () => {
    const backing = memoryStorage();
    const tabA = createWebStorage(backing);
    const tabB = createWebStorage(backing);

    await tabA.set("rotated-by-tab-a");

    expect(await tabB.get()).toBe("rotated-by-tab-a");
  });

  it("when the browser blocks storage: keeps the token in memory, says so once, and clears it too", async () => {
    const storage = createWebStorage(memoryStorage(true));

    await storage.set("t");
    expect(await storage.get()).toBe("t");
    await storage.clear();
    expect(await storage.get()).toBeNull();

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("works without any storage object at all", async () => {
    const storage = createWebStorage(undefined);

    await storage.set("t");

    expect(await storage.get()).toBe("t");
  });
});

describe("one refresh at a time across tabs", () => {
  it("has no lock where the browser has no navigator.locks", () => {
    vi.stubGlobal("navigator", {});

    expect(createWebRefreshLock()).toBeUndefined();
  });

  it("runs the task inside a named browser lock and returns its result", async () => {
    const names: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: (name: string, task: () => Promise<unknown>) => {
          names.push(name);
          return task();
        },
      },
    });

    const lock = createWebRefreshLock()!;
    const result = await lock(async () => "done");

    expect(result).toBe("done");
    expect(names).toEqual(["music-room.refresh"]);
  });

  it("passes a failure of the task through", async () => {
    vi.stubGlobal("navigator", {
      locks: { request: (_: string, task: () => Promise<unknown>) => task() },
    });

    await expect(
      createWebRefreshLock()!(async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
  });
});
