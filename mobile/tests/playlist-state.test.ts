import type { PlaylistEntry, PlaylistSnapshot } from "@music-room/shared";
import { describe, expect, it } from "vitest";
import {
  applyPlaylist,
  EMPTY_PLAYLIST,
  moveDownAnchor,
  moveUpAnchor,
} from "@/features/playlist-editor/playlist-state";

const entry = (id: string): PlaylistEntry => ({
  id,
  track: {
    providerTrackId: `p-${id}`,
    title: id,
    artist: "A",
    durationSeconds: 100,
    coverUrl: null,
  },
  addedBy: "u1",
  addedAt: "2026-10-23T10:00:00Z",
});
const snapshot = (version: number, ids: string[]): PlaylistSnapshot => ({
  playlistId: "p1",
  version,
  tracks: ids.map(entry),
});
const ids = (entries: PlaylistEntry[]) => entries.map((e) => e.id);

/** The server's rule (ADR-009): take the entry out, put it after the anchor (null = first). */
function moveAfter(list: string[], moved: string, anchor: string | null): string[] {
  const rest = list.filter((id) => id !== moved);
  const at = anchor === null ? 0 : rest.indexOf(anchor) + 1;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

describe("applying the server's lists", () => {
  it("shows the first list in the server's order", () => {
    expect(ids(applyPlaylist(EMPTY_PLAYLIST, snapshot(0, ["a", "b"])).entries)).toEqual([
      "a",
      "b",
    ]);
  });

  it("an empty playlist is still a loaded one (version 0)", () => {
    expect(applyPlaylist(EMPTY_PLAYLIST, snapshot(0, []))).toEqual({
      version: 0,
      entries: [],
    });
  });

  it("a newer list replaces it; an older or equal one arriving late is ignored", () => {
    const v3 = applyPlaylist(EMPTY_PLAYLIST, snapshot(3, ["a", "b"]));

    expect(applyPlaylist(v3, snapshot(2, ["old"]))).toBe(v3);
    expect(applyPlaylist(v3, snapshot(3, ["same"]))).toBe(v3);
    expect(ids(applyPlaylist(v3, snapshot(5, ["b", "a", "c"])).entries)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("an edit's answer and the live update of the same edit, in either order, end the same", () => {
    const base = applyPlaylist(EMPTY_PLAYLIST, snapshot(1, ["a", "b"]));
    const edited = snapshot(2, ["b", "a"]);

    expect(applyPlaylist(applyPlaylist(base, edited), edited)).toEqual(
      applyPlaylist(base, edited),
    );
  });
});

describe("moving one place, as an anchor (never an index)", () => {
  const list = ["a", "b", "c", "d"].map(entry);
  const order = ["a", "b", "c", "d"];

  it.each([
    [1, ["b", "a", "c", "d"]],
    [2, ["a", "c", "b", "d"]],
    [3, ["a", "b", "d", "c"]],
  ])("up from index %i gives %j once the server applies it", (index, expected) => {
    const anchor = moveUpAnchor(list, index);

    expect(anchor).not.toBeUndefined();
    expect(moveAfter(order, order[index]!, anchor!)).toEqual(expected);
  });

  it.each([
    [0, ["b", "a", "c", "d"]],
    [1, ["a", "c", "b", "d"]],
    [2, ["a", "b", "d", "c"]],
  ])("down from index %i gives %j once the server applies it", (index, expected) => {
    const anchor = moveDownAnchor(list, index);

    expect(anchor).not.toBeUndefined();
    expect(moveAfter(order, order[index]!, anchor!)).toEqual(expected);
  });

  it("moving up to the first place sends null (the start)", () => {
    expect(moveUpAnchor(list, 1)).toBeNull();
  });

  it("the first cannot move up, the last cannot move down, nor anything out of range", () => {
    expect(moveUpAnchor(list, 0)).toBeUndefined();
    expect(moveDownAnchor(list, 3)).toBeUndefined();
    expect(moveUpAnchor(list, 9)).toBeUndefined();
    expect(moveDownAnchor(list, -1)).toBeUndefined();
    expect(moveDownAnchor([entry("only")], 0)).toBeUndefined();
  });
});
