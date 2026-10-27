import type { PlaylistEntry } from "@music-room/shared";
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import { createConnectivity } from "@/offline/connectivity";
import { createOfflineStore, type KeyValueStorage } from "@/offline/offline-store";
import {
  applyPending,
  createOutbox,
  outcomeOf,
  type PendingChange,
} from "@/offline/outbox";

// Offline mode (ADR-049): knowing the server is unreachable, keeping copies, and replaying the
// playlist changes made offline, where the server has the last word.

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    getAllKeys: async () => [...map.keys()],
    multiRemove: async (keys) => keys.forEach((k) => map.delete(k)),
  };
}
const fail = (status: number, code: string) =>
  new RequestError(status, code as never, "x");

describe("connectivity", () => {
  function setup(pingAnswers: boolean[]) {
    let tick: (() => void) | null = null;
    const clearTimer = vi.fn(() => {
      tick = null;
    });
    const ping = vi.fn(async () => pingAnswers.shift() ?? false);
    const c = createConnectivity({
      ping,
      setTimer: (run) => {
        tick = run;
        return 1;
      },
      clearTimer,
    });
    return {
      c,
      ping,
      clearTimer,
      tick: async () => {
        tick?.();
        await new Promise((r) => setTimeout(r, 0));
      },
      ticking: () => tick !== null,
    };
  }

  it("starts online, goes offline on an unreachable request, and tells listeners once", () => {
    const { c } = setup([]);
    const seen: boolean[] = [];
    c.subscribe((online) => seen.push(online));

    c.reportUnreachable();
    c.reportUnreachable();

    expect(c.isOnline()).toBe(false);
    expect(seen).toEqual([false]);
  });

  it("while offline, pings until the server answers, then stops pinging", async () => {
    const { c, ping, ticking, tick } = setup([false, true]);
    c.reportUnreachable();
    expect(ticking()).toBe(true);

    await tick();
    expect(c.isOnline()).toBe(false);
    await tick();

    expect(c.isOnline()).toBe(true);
    expect(ping).toHaveBeenCalledTimes(2);
    expect(ticking()).toBe(false);
  });

  it("any answer from the server, even an error, means online again", () => {
    const { c } = setup([]);
    c.reportUnreachable();

    c.reportReachable();

    expect(c.isOnline()).toBe(true);
  });
});

describe("the offline store", () => {
  it("keeps a copy with when it was saved", async () => {
    const store = createOfflineStore(
      memoryStorage(),
      () => new Date("2026-10-27T14:32:00Z"),
    );

    await store.write("rooms", [{ id: "r1" }]);

    expect(await store.read("rooms")).toEqual({
      data: [{ id: "r1" }],
      savedAt: "2026-10-27T14:32:00.000Z",
    });
  });

  it("a missing or broken copy is simply nothing", async () => {
    const storage = memoryStorage();
    storage.map.set("offline:v1:broken", "{not json");
    const store = createOfflineStore(storage);

    expect(await store.read("nothing")).toBeNull();
    expect(await store.read("broken")).toBeNull();
  });

  it("clear removes every offline key and nothing else (the server address stays)", async () => {
    const storage = memoryStorage();
    storage.map.set("backend-url", "http://x");
    const store = createOfflineStore(storage);
    await store.write("rooms", []);
    await store.write("outbox", []);

    await store.clear();

    expect([...storage.map.keys()]).toEqual(["backend-url"]);
  });
});

const entry = (id: string): PlaylistEntry => ({
  id,
  track: {
    providerTrackId: id,
    title: `Song ${id}`,
    artist: "A",
    durationSeconds: 1,
    coverUrl: null,
  },
  addedBy: "u",
  addedAt: "2026-10-27T00:00:00Z",
});
const ids = (entries: PlaylistEntry[]) => entries.map((e) => e.id);
const move = (entryId: string, afterEntryId: string | null): PendingChange => ({
  opId: `op-${entryId}`,
  playlistId: "p",
  entryId,
  trackTitle: `Song ${entryId}`,
  queuedAt: "",
  kind: "move",
  afterEntryId,
});
const remove = (entryId: string): PendingChange => ({
  opId: `op-${entryId}`,
  playlistId: "p",
  entryId,
  trackTitle: `Song ${entryId}`,
  queuedAt: "",
  kind: "remove",
});

describe("pending changes on the phone's copy", () => {
  const list = ["a", "b", "c", "d"].map(entry);

  it("moves after an entry, to the start, and removes, in order", () => {
    expect(ids(applyPending(list, [move("d", "a")]))).toEqual(["a", "d", "b", "c"]);
    expect(ids(applyPending(list, [move("c", null)]))).toEqual(["c", "a", "b", "d"]);
    expect(ids(applyPending(list, [remove("b"), move("a", "c")]))).toEqual([
      "c",
      "a",
      "d",
    ]);
  });

  it("skips a change whose entry is gone, and leaves a move in place if its anchor is gone", () => {
    expect(ids(applyPending(list, [move("x", "a")]))).toEqual(["a", "b", "c", "d"]);
    expect(ids(applyPending(list, [remove("a"), move("c", "a")]))).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("does not change the list it was given", () => {
    applyPending(list, [remove("a")]);
    expect(ids(list)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("what the server's answer means for a change", () => {
  it.each([
    ["accepted", move("a", null), null, { kind: "applied" }],
    [
      "a removal of a track already gone counts as done",
      remove("a"),
      fail(404, "TRACK_NOT_FOUND"),
      { kind: "applied" },
    ],
    [
      "a move of a track gone is dropped",
      move("a", null),
      fail(404, "TRACK_NOT_FOUND"),
      { kind: "dropped", reason: "trackGone" },
    ],
    [
      "its anchor gone (the agreed policy: drop and tell)",
      move("a", "b"),
      fail(409, "ANCHOR_NOT_FOUND"),
      { kind: "dropped", reason: "anchorGone" },
    ],
    [
      "Premium needed (downgraded meanwhile)",
      remove("a"),
      fail(403, "PREMIUM_REQUIRED"),
      { kind: "dropped", reason: "premium" },
    ],
    [
      "the playlist gone or hidden",
      remove("a"),
      fail(404, "PLAYLIST_NOT_FOUND"),
      { kind: "dropped", reason: "noAccess" },
    ],
    [
      "not allowed by the license anymore",
      remove("a"),
      fail(403, "NOT_INVITED"),
      { kind: "dropped", reason: "noAccess" },
    ],
    ["offline again", remove("a"), fail(0, "NETWORK_ERROR"), { kind: "retry" }],
    ["rate limited", remove("a"), fail(429, "RATE_LIMITED"), { kind: "retry" }],
    ["server trouble", remove("a"), fail(503, "INTERNAL_ERROR"), { kind: "retry" }],
    [
      "any other refusal",
      remove("a"),
      fail(400, "VALIDATION_ERROR"),
      { kind: "dropped", reason: "refused" },
    ],
  ])("%s", (_label, change, error, outcome) => {
    expect(outcomeOf(change, error)).toEqual(outcome);
  });
});

describe("the outbox", () => {
  function setup(answers: (Error | null)[]) {
    const store = createOfflineStore(memoryStorage());
    const sent: string[] = [];
    let n = 0;
    const outbox = createOutbox({
      store,
      newId: () => `id${++n}`,
      send: async (change) => {
        sent.push(`${change.kind}:${change.entryId}`);
        const answer = answers.shift() ?? null;
        if (answer) throw answer;
      },
    });
    return { outbox, store, sent };
  }
  const queueMove = (entryId: string, afterEntryId: string | null) => ({
    playlistId: "p",
    entryId,
    trackTitle: `Song ${entryId}`,
    kind: "move" as const,
    afterEntryId,
  });

  it("keeps changes across restarts (in the store), in order", async () => {
    const { outbox, store } = setup([]);
    await outbox.enqueue(queueMove("a", null));
    await outbox.enqueue({
      playlistId: "p",
      entryId: "b",
      trackTitle: "Song b",
      kind: "remove",
    });

    const again = createOutbox({ store, newId: () => "x", send: async () => {} });

    expect((await again.pendingFor("p")).map((c) => c.entryId)).toEqual(["a", "b"]);
  });

  it("sends them in order, and reports what synced and what was dropped and why", async () => {
    const { outbox, sent } = setup([null, fail(409, "ANCHOR_NOT_FOUND"), null]);
    await outbox.enqueue(queueMove("a", null));
    await outbox.enqueue(queueMove("b", "gone"));
    await outbox.enqueue(queueMove("c", null));

    const summary = await outbox.sync();

    expect(sent).toEqual(["move:a", "move:b", "move:c"]);
    expect(summary).toEqual({
      synced: 2,
      dropped: [{ reason: "anchorGone", trackTitle: "Song b" }],
    });
    expect(await outbox.count()).toBe(0);
    expect(outbox.summary()).toEqual(summary);
    outbox.dismissSummary();
    expect(outbox.summary()).toBeNull();
  });

  it("stops at a change it cannot decide, keeping it and the rest in order for later", async () => {
    const { outbox, sent } = setup([null, fail(0, "NETWORK_ERROR")]);
    await outbox.enqueue(queueMove("a", null));
    await outbox.enqueue(queueMove("b", null));
    await outbox.enqueue(queueMove("c", null));

    const summary = await outbox.sync();

    expect(sent).toEqual(["move:a", "move:b"]);
    expect(summary.synced).toBe(1);
    expect((await outbox.pendingFor("p")).map((c) => c.entryId)).toEqual(["b", "c"]);
  });

  it("runs one sync at a time: a second call gets the same one", async () => {
    const { outbox, sent } = setup([]);
    await outbox.enqueue(queueMove("a", null));

    const [first, second] = await Promise.all([outbox.sync(), outbox.sync()]);

    expect(sent).toEqual(["move:a"]);
    expect(second).toBe(first);
  });

  it("only gives the changes of the playlist asked for", async () => {
    const { outbox } = setup([]);
    await outbox.enqueue(queueMove("a", null));
    await outbox.enqueue({ ...queueMove("b", null), playlistId: "other" });

    expect((await outbox.pendingFor("other")).map((c) => c.entryId)).toEqual(["b"]);
  });
});
