import type { Track } from "@music-room/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peopleQueryFrom, searchQueryFrom } from "@/api/search-query";
import { createLatestSearch, type SearchState } from "@/api/latest-search";

const track = (title: string): Track => ({
  providerTrackId: title,
  title,
  artist: "Artist",
  durationSeconds: 100,
  coverUrl: null,
});

describe("the query sent to the catalog", () => {
  it("is trimmed, with inner spaces collapsed", () => {
    expect(searchQueryFrom("  daft   punk ")).toBe("daft punk");
  });

  it("is nothing below 2 characters (the backend would refuse it)", () => {
    expect(searchQueryFrom("")).toBeNull();
    expect(searchQueryFrom(" a ")).toBeNull();
    expect(searchQueryFrom("ab")).toBe("ab");
  });

  it("is cut at 100 characters (the backend's maximum)", () => {
    expect(searchQueryFrom("x".repeat(150))).toHaveLength(100);
  });
});

describe("the query sent to find people (GET /users)", () => {
  it("needs 3 characters (so nobody can list everyone) and is cut at 50", () => {
    expect(peopleQueryFrom("ad")).toBeNull();
    expect(peopleQueryFrom("  ada  ")).toBe("ada");
    expect(peopleQueryFrom("x".repeat(80))).toHaveLength(50);
  });
});

describe("searching while typing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(search: (q: string) => Promise<Track[]>) {
    const states: SearchState<Track>[] = [];
    const searchFn = vi.fn(search);
    const runner = createLatestSearch<Track>({
      queryFrom: searchQueryFrom,
      search: searchFn,
      onChange: (s) => states.push(s),
      delayMs: 400,
    });
    return { runner, states, searchFn };
  }

  it("waits until typing pauses, then searches once for the last text", async () => {
    const { runner, searchFn, states } = setup(async (q) => [track(q)]);

    runner.input("da");
    await vi.advanceTimersByTimeAsync(200);
    runner.input("daf");
    await vi.advanceTimersByTimeAsync(200);
    runner.input("daft");
    await vi.advanceTimersByTimeAsync(400);

    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn).toHaveBeenCalledWith("daft");
    expect(states.at(-1)).toEqual({
      status: "done",
      query: "daft",
      results: [track("daft")],
    });
  });

  it("shows only the latest query's answer, even if an older one arrives last", async () => {
    const answers: Record<string, (tracks: Track[]) => void> = {};
    const { runner, states } = setup(
      (q) => new Promise<Track[]>((resolve) => (answers[q] = resolve)),
    );

    runner.input("slow");
    await vi.advanceTimersByTimeAsync(400);
    runner.input("fast");
    await vi.advanceTimersByTimeAsync(400);
    answers["fast"]!([track("fast")]);
    answers["slow"]!([track("slow")]);
    await vi.runAllTimersAsync();

    const done = states.filter((s) => s.status === "done");
    expect(done).toEqual([{ status: "done", query: "fast", results: [track("fast")] }]);
  });

  it("goes back to idle, without searching, when the text gets too short", async () => {
    const { runner, searchFn, states } = setup(async () => []);

    runner.input("daft");
    runner.input("d");
    await vi.advanceTimersByTimeAsync(1000);

    expect(searchFn).not.toHaveBeenCalled();
    expect(states).toEqual([{ status: "idle" }]);
  });

  it("does not search again when only spaces changed", async () => {
    const { runner, searchFn } = setup(async () => []);

    runner.input("daft punk");
    await vi.advanceTimersByTimeAsync(400);
    runner.input("daft punk ");
    await vi.advanceTimersByTimeAsync(400);

    expect(searchFn).toHaveBeenCalledTimes(1);
  });

  it("reports a failure, and retry searches the same text again at once", async () => {
    let fail = true;
    const { runner, searchFn, states } = setup(async (q) => {
      if (fail) throw new Error("502");
      return [track(q)];
    });

    runner.input("daft");
    await vi.advanceTimersByTimeAsync(400);
    expect(states.at(-1)).toMatchObject({ status: "failed", query: "daft" });

    fail = false;
    runner.retry();
    await vi.runAllTimersAsync();

    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({
      status: "done",
      query: "daft",
      results: [track("daft")],
    });
  });

  it("reports nothing after dispose (the screen closed)", async () => {
    let finish: (tracks: Track[]) => void = () => undefined;
    const { runner, states } = setup(() => new Promise((resolve) => (finish = resolve)));

    runner.input("daft");
    await vi.advanceTimersByTimeAsync(400);
    runner.dispose();
    finish([track("late")]);
    await vi.runAllTimersAsync();

    expect(states).toEqual([{ status: "searching", query: "daft" }]);
  });
});
