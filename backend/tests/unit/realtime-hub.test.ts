import type pg from "pg";
import pino from "pino";
import { Writable } from "node:stream";
import type { Server } from "socket.io";
import { describe, expect, it } from "vitest";
import {
  createRealtimeHub,
  eventRoom,
  playlistRoom,
} from "../../src/sockets/realtime.js";

// The hub against a FAKE Socket.io and a FAKE database, so the moment each read finishes
// is under the test's control. (tests/integration/realtime.test.ts uses real sockets.)
const EVENT = "11111111-1111-4111-8111-111111111111";
const PLAYLIST = "33333333-3333-4333-8333-333333333333";

function setup(options: { subscribers?: number } = {}) {
  const emitted: { room: string; name: string; payload: unknown }[] = [];
  const rooms = new Map<string, Set<string>>();
  if ((options.subscribers ?? 1) > 0) {
    rooms.set(eventRoom(EVENT), new Set(["socket-1"]));
    rooms.set(playlistRoom(PLAYLIST), new Set(["socket-3"]));
  }
  const live = {
    adapter: { rooms },
    to: (room: string) => ({
      emit: (name: string, payload: unknown) => emitted.push({ room, name, payload }),
    }),
    in: () => ({ fetchSockets: () => Promise.resolve([]), socketsLeave: () => {} }),
  };
  const io = { of: () => live } as unknown as Server;

  // Each database read waits for the test to release it.
  const reads: {
    release: (version: number) => void;
    noSuchEvent: () => void;
    fail: (error: Error) => void;
  }[] = [];
  const pool = {
    query: () =>
      new Promise((resolve, reject) => {
        reads.push({
          release: (version) =>
            resolve({
              // events read `queue_version`, playlists read `version`
              rows: [
                { queue_version: String(version), version: String(version), id: null },
              ],
            }),
          noSuchEvent: () => resolve({ rows: [] }),
          fail: reject,
        });
      }),
  } as unknown as pg.Pool;

  const logLines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  const hub = createRealtimeHub({ io, pool, logger: pino({ level: "info" }, sink) });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { hub, emitted, reads, logLines, settle, rooms };
}

describe("queue broadcasts", () => {
  it("builds one snapshot for one change", async () => {
    const { hub, emitted, reads, settle } = setup();

    hub.queueChanged(EVENT);
    await settle();
    reads[0]!.release(5);
    await settle();

    expect(reads).toHaveLength(1);
    expect(emitted).toEqual([
      {
        room: eventRoom(EVENT),
        name: "event:queue",
        payload: { eventId: EVENT, version: 5, tracks: [] },
      },
    ]);
  });

  it("coalesces a burst: changes during a read cost ONE more read, not one each", async () => {
    const { hub, emitted, reads, settle } = setup();

    hub.queueChanged(EVENT); // starts read 1
    await settle();
    for (let i = 0; i < 29; i++) hub.queueChanged(EVENT); // 29 more while read 1 is pending
    await settle();
    expect(reads).toHaveLength(1); // none of them started a read
    reads[0]!.release(10);
    await settle();
    expect(reads).toHaveLength(2); // exactly one trailing read for all 29
    reads[1]!.release(40);
    await settle();

    expect(reads).toHaveLength(2);
    expect(emitted.map((e) => (e.payload as { version: number }).version)).toEqual([
      10, 40,
    ]);
  });

  it("does not send the same snapshot twice when the trailing read finds nothing new", async () => {
    const { hub, emitted, reads, settle } = setup();

    hub.queueChanged(EVENT); // read 1
    await settle();
    hub.queueChanged(EVENT); // a change the first read may already include
    await settle();
    reads[0]!.release(12);
    await settle();
    reads[1]!.release(12); // the trailing read sees the very same version
    await settle();

    expect(reads).toHaveLength(2);
    expect(emitted.map((e) => (e.payload as { version: number }).version)).toEqual([12]);
  });

  it("keeps events apart: a change to one event does not wait for another", async () => {
    const { hub, reads, rooms, settle } = setup();
    const other = "22222222-2222-4222-8222-222222222222";
    rooms.set(eventRoom(other), new Set(["socket-2"]));

    hub.queueChanged(EVENT);
    hub.queueChanged(other);
    await settle();

    expect(reads).toHaveLength(2);
  });

  it("does not read the database when nobody is subscribed", async () => {
    const { hub, reads, emitted, settle } = setup({ subscribers: 0 });

    hub.queueChanged(EVENT);
    await settle();

    expect(reads).toHaveLength(0);
    expect(emitted).toEqual([]);
  });

  it("stays quiet when the event has been deleted meanwhile", async () => {
    const { hub, emitted, reads, logLines, settle } = setup();
    hub.queueChanged(EVENT);
    await settle();

    reads[0]!.noSuchEvent(); // the database no longer has this event
    await settle();

    expect(emitted).toEqual([]);
    expect(logLines.join("")).not.toContain("failed"); // not an error: eventDeleted tells the room
  });

  it("never throws and never fails the caller when the database fails; it logs instead", async () => {
    const { hub, reads, logLines, settle } = setup();

    expect(() => hub.queueChanged(EVENT)).not.toThrow();
    await settle();
    reads[0]!.fail(new Error("database down"));
    await settle();

    expect(logLines.join("")).toContain("event broadcast failed");
  });

  it("can broadcast again after a failure (the failed attempt does not wedge the event)", async () => {
    const { hub, emitted, reads, settle } = setup();
    hub.queueChanged(EVENT);
    await settle();
    reads[0]!.fail(new Error("boom"));
    await settle();

    hub.queueChanged(EVENT);
    await settle();
    reads[1]!.release(3);
    await settle();

    expect(emitted).toHaveLength(1);
  });

  it("sends nothing but the shared fields: no votedByMe anywhere in a snapshot", async () => {
    const { hub, emitted, reads, settle } = setup();
    hub.queueChanged(EVENT);
    await settle();
    reads[0]!.release(1);
    await settle();

    expect(JSON.stringify(emitted)).not.toContain("votedByMe");
  });
});

describe("playlist broadcasts", () => {
  it("sends the snapshot as playlist:updated to the playlist's own room", async () => {
    const { hub, emitted, reads, settle } = setup();

    hub.playlistChanged(PLAYLIST);
    await settle();
    reads[0]!.release(7);
    await settle();

    expect(emitted).toEqual([
      {
        room: playlistRoom(PLAYLIST),
        name: "playlist:updated",
        payload: { playlistId: PLAYLIST, version: 7, tracks: [] },
      },
    ]);
  });

  it("coalesces a burst of edits into one trailing read, like the event queue", async () => {
    const { hub, emitted, reads, settle } = setup();

    hub.playlistChanged(PLAYLIST);
    await settle();
    for (let i = 0; i < 29; i++) hub.playlistChanged(PLAYLIST);
    await settle();
    expect(reads).toHaveLength(1);
    reads[0]!.release(10);
    await settle();
    expect(reads).toHaveLength(2);
    reads[1]!.release(40);
    await settle();

    expect(emitted.map((e) => (e.payload as { version: number }).version)).toEqual([
      10, 40,
    ]);
  });

  it("does not send the same version twice", async () => {
    const { hub, emitted, reads, settle } = setup();
    hub.playlistChanged(PLAYLIST);
    await settle();
    hub.playlistChanged(PLAYLIST);
    await settle();
    reads[0]!.release(12);
    await settle();
    reads[1]!.release(12);
    await settle();

    expect(emitted).toHaveLength(1);
  });

  it("works independently of an event with the same moment: each has its own room and its own flight", async () => {
    const { hub, reads, emitted, settle } = setup();

    hub.queueChanged(EVENT);
    hub.playlistChanged(PLAYLIST);
    await settle();
    expect(reads).toHaveLength(2);
    reads[0]!.release(1);
    reads[1]!.release(2);
    await settle();

    expect(emitted.map((e) => e.room).sort()).toEqual(
      [eventRoom(EVENT), playlistRoom(PLAYLIST)].sort(),
    );
  });

  it("does not read the database when nobody follows the playlist", async () => {
    const { hub, reads, settle } = setup({ subscribers: 0 });

    hub.playlistChanged(PLAYLIST);
    await settle();

    expect(reads).toHaveLength(0);
  });

  it("never throws and logs a failure", async () => {
    const { hub, reads, logLines, settle } = setup();

    expect(() => hub.playlistChanged(PLAYLIST)).not.toThrow();
    await settle();
    reads[0]!.fail(new Error("database down"));
    await settle();

    expect(logLines.join("")).toContain("playlist broadcast failed");
  });
});
