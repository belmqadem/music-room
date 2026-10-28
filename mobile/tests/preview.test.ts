import { describe, expect, it, vi } from "vitest";
import { RequestError } from "@/api/api-error";
import type { EventQueueUpdate, EventTrack } from "@music-room/shared";
import { classifyPreviewError } from "@/audio/preview-errors";
import { followPlayingTrack } from "@/features/track-vote/owner-playback";
import {
  createPreviewPlayer,
  phaseOf,
  type AudioOutput,
  type OutputStatus,
} from "@/audio/preview-player";

// Track previews (ADR-053): one sample at a time, play / pause on the same cover, a link asked for
// at every play, and nothing left sounding after the person moved on.

const URL_OF = (id: string) => `https://cdnt-preview.dzcdn.net/${id}.mp3`;

function fakeOutput() {
  let listener: ((status: OutputStatus) => void) | null = null;
  const output = {
    load: vi.fn<(url: string) => void>(),
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    seekTo: vi.fn(async (_seconds: number) => {}),
    onStatus(next: (status: OutputStatus) => void) {
      listener = next;
      return () => {
        listener = null;
      };
    },
  } satisfies AudioOutput;
  const report = (status: Partial<OutputStatus>) =>
    listener?.({ playing: false, didJustFinish: false, error: null, ...status });
  return { output, report };
}

/** A link request the test answers when it wants (to play out races). */
function deferredLinks() {
  const pending = new Map<
    string,
    { resolve: (url: string) => void; reject: (e: unknown) => void }
  >();
  const fetchPreviewUrl = vi.fn(
    (id: string) =>
      new Promise<string>((resolve, reject) => pending.set(id, { resolve, reject })),
  );
  return {
    fetchPreviewUrl,
    answer: async (id: string) => {
      pending.get(id)!.resolve(URL_OF(id));
      await Promise.resolve();
      await Promise.resolve();
    },
    fail: async (id: string, error: unknown) => {
      pending.get(id)!.reject(error);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function setup() {
  const { output, report } = fakeOutput();
  const links = deferredLinks();
  const classify = vi.fn((error: unknown) =>
    error instanceof RequestError && error.code === "PREVIEW_UNAVAILABLE"
      ? ("unavailable" as const)
      : error instanceof RequestError && error.code === "NETWORK_ERROR"
        ? ("offline" as const)
        : ("unknown" as const),
  );
  const player = createPreviewPlayer({
    fetchPreviewUrl: links.fetchPreviewUrl,
    output,
    classify,
  });
  return { player, output, report, links };
}

describe("playing a preview", () => {
  it("asks for a fresh link, plays it, and counts as playing once the phone says so", async () => {
    const { player, output, report, links } = setup();

    void player.toggle("1");
    expect(player.getState()).toEqual({ trackId: "1", phase: "loading", failure: null });
    await links.answer("1");

    expect(links.fetchPreviewUrl).toHaveBeenCalledWith("1");
    expect(output.load).toHaveBeenCalledWith(URL_OF("1"));
    expect(output.play).toHaveBeenCalled();
    report({ playing: true });
    expect(player.getState().phase).toBe("playing");
  });

  it("pauses on the second press and resumes on the third, without asking for a new link", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });

    await player.toggle("1");
    expect(output.pause).toHaveBeenCalled();
    expect(player.getState().phase).toBe("paused");

    await player.toggle("1");
    expect(player.getState().phase).toBe("playing");
    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("asks for a new link each time it starts over: links expire", async () => {
    const { player, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });
    player.stop();

    void player.toggle("1");

    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(2);
  });

  it("after the 30 seconds, it shows as paused and plays again from the top", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });

    report({ didJustFinish: true });
    expect(player.getState().phase).toBe("paused");

    await player.toggle("1");
    expect(output.seekTo).toHaveBeenCalledWith(0);
    expect(player.getState().phase).toBe("playing");
  });
});

describe("one track at a time", () => {
  it("another track's cover takes over: the first is paused, the second loads", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });
    output.pause.mockClear();

    void player.toggle("2");

    expect(output.pause).toHaveBeenCalled();
    expect(player.getState()).toEqual({ trackId: "2", phase: "loading", failure: null });
    expect(phaseOf(player.getState(), "1")).toBe("idle");
  });

  it("a link that arrives after the person chose another track is dropped", async () => {
    const { player, output, links } = setup();
    void player.toggle("1");
    void player.toggle("2");

    await links.answer("1");
    await links.answer("2");

    expect(output.load).toHaveBeenCalledTimes(1);
    expect(output.load).toHaveBeenCalledWith(URL_OF("2"));
    expect(player.getState().trackId).toBe("2");
  });

  it("pressing again while it loads cancels it, and the late link is not played", async () => {
    const { player, output, links } = setup();
    void player.toggle("1");

    await player.toggle("1");
    await links.answer("1");

    expect(player.getState()).toEqual({ trackId: null, phase: "idle", failure: null });
    expect(output.play).not.toHaveBeenCalled();
  });
});

describe("stopping", () => {
  it("silences the sample and forgets it (leaving the screen, closing the search, signing out)", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });

    player.stop();

    expect(output.pause).toHaveBeenCalled();
    expect(player.getState()).toEqual({ trackId: null, phase: "idle", failure: null });
  });

  it("a link that arrives after a stop is not played", async () => {
    const { player, output, links } = setup();
    void player.toggle("1");
    player.stop();

    await links.answer("1");

    expect(output.load).not.toHaveBeenCalled();
    expect(player.getState().phase).toBe("idle");
  });

  it("tells its listeners about every change, and not after they unsubscribe", async () => {
    const { player, links } = setup();
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);

    void player.toggle("1");
    await links.answer("1");
    unsubscribe();
    player.stop();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("when it can't play", () => {
  it("a track without a sample says so, and only on that track", async () => {
    const { player, links } = setup();
    void player.toggle("1");

    await links.fail("1", new RequestError(404, "PREVIEW_UNAVAILABLE", "x"));

    expect(player.getState()).toEqual({
      trackId: "1",
      phase: "failed",
      failure: "unavailable",
    });
    expect(phaseOf(player.getState(), "2")).toBe("idle");
  });

  it("offline, it says previews need a connection, and a new press tries again", async () => {
    const { player, links } = setup();
    void player.toggle("1");
    await links.fail("1", new RequestError(0, "NETWORK_ERROR", "x"));
    expect(player.getState().failure).toBe("offline");

    void player.toggle("1");

    expect(player.getState().phase).toBe("loading");
    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(2);
  });

  it("a sample the phone can't load is a failure, not a silent spinner", async () => {
    const { player, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");

    report({ error: "unsupported format" });

    expect(player.getState()).toEqual({
      trackId: "1",
      phase: "failed",
      failure: "unknown",
    });
  });

  it("a failure that arrives after the person moved on is ignored", async () => {
    const { player, links } = setup();
    void player.toggle("1");
    void player.toggle("2");

    await links.fail("1", new RequestError(0, "NETWORK_ERROR", "x"));

    expect(player.getState()).toEqual({ trackId: "2", phase: "loading", failure: null });
  });
});

describe("why a preview didn't play", () => {
  it.each([
    [new RequestError(404, "PREVIEW_UNAVAILABLE", "x"), "unavailable"],
    [new RequestError(404, "TRACK_NOT_FOUND", "x"), "unavailable"],
    [new RequestError(0, "NETWORK_ERROR", "x"), "offline"],
    [new RequestError(502, "PROVIDER_UNAVAILABLE", "x"), "unknown"],
    [new RequestError(429, "RATE_LIMITED", "x"), "unknown"],
    [new Error("bug"), "unknown"],
  ])("%s is %s", (error, expected) => {
    expect(classifyPreviewError(error)).toBe(expected);
  });
});

describe("play: the owner asked for music, so it sounds whatever it was doing", () => {
  it("starts a track nothing was playing", async () => {
    const { player, output, links } = setup();

    void player.play("1");
    await links.answer("1");

    expect(output.load).toHaveBeenCalledWith(URL_OF("1"));
    expect(output.play).toHaveBeenCalled();
  });

  it("leaves a track that is already playing alone: no pause, no new link", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });
    output.pause.mockClear();

    await player.play("1");

    expect(output.pause).not.toHaveBeenCalled();
    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(1);
    expect(player.getState().phase).toBe("playing");
  });

  it("resumes a paused track without a new link", async () => {
    const { player, links, report } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });
    await player.toggle("1");

    await player.play("1");

    expect(player.getState().phase).toBe("playing");
    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(1);
  });

  it("switches from another track's sample", async () => {
    const { player, output, report, links } = setup();
    void player.toggle("1");
    await links.answer("1");
    report({ playing: true });

    void player.play("2");

    expect(output.pause).toHaveBeenCalled();
    expect(player.getState()).toEqual({ trackId: "2", phase: "loading", failure: null });
  });

  it("tries again after a failure", async () => {
    const { player, links } = setup();
    void player.play("1");
    await links.fail("1", new RequestError(0, "NETWORK_ERROR", "x"));

    void player.play("1");

    expect(links.fetchPreviewUrl).toHaveBeenCalledTimes(2);
    expect(player.getState().phase).toBe("loading");
  });
});

describe("the owner's phone follows the playing track after Start playing / Next track", () => {
  const entry = (id: string, status: EventTrack["status"]): EventTrack =>
    ({
      id: `entry-${id}`,
      status,
      track: {
        providerTrackId: id,
        title: id,
        artist: "a",
        durationSeconds: 1,
        coverUrl: null,
      },
    }) as EventTrack;
  const update = (tracks: EventTrack[]): EventQueueUpdate => ({
    eventId: "e",
    version: 2,
    tracks,
  });

  it("plays the track the server now says is playing", () => {
    const player = { play: vi.fn(async () => {}), stop: vi.fn() };

    followPlayingTrack(update([entry("7", "playing"), entry("8", "queued")]), player);

    expect(player.play).toHaveBeenCalledWith("7");
    expect(player.stop).not.toHaveBeenCalled();
  });

  it("falls silent when the queue ran out", () => {
    const player = { play: vi.fn(async () => {}), stop: vi.fn() };

    followPlayingTrack(update([]), player);

    expect(player.stop).toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });
});
