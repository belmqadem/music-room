import { describe, expect, it } from "vitest";
import { CatalogUnavailableError } from "../../src/modules/track-vote/catalog.js";
import {
  cleanCoverUrl,
  cleanPreviewUrl,
  createDeezerCatalog,
} from "../../src/modules/track-vote/deezer-catalog.js";

// The Deezer adapter against a FAKE Deezer (the real one is never called from the tests).
// Deezer reports many failures as HTTP 200 with an `error` body; the fakes do the same.
const COVER =
  "https://cdn-images.dzcdn.net/images/cover/5718f7c8/250x250-000000-80-0-0.jpg";

const rawTrack = (overrides: Record<string, unknown> = {}) => ({
  id: 3135556,
  title: "Harder, Better, Faster, Stronger",
  duration: 226,
  artist: { name: "Daft Punk" },
  album: { cover_medium: COVER },
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A fake Deezer that records every URL asked for. */
function fakeDeezer(respond: (url: URL) => Response | Promise<Response>) {
  const requested: URL[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url);
    return respond(url);
  }) as typeof fetch;
  return { catalog: createDeezerCatalog({ fetch: fakeFetch }), requested };
}

describe("getTrack", () => {
  it("returns the track with title, artist, duration and cover", async () => {
    const { catalog, requested } = fakeDeezer(() => json(rawTrack()));

    expect(await catalog.getTrack("3135556")).toEqual({
      providerTrackId: "3135556",
      title: "Harder, Better, Faster, Stronger",
      artist: "Daft Punk",
      durationSeconds: 226,
      coverUrl: COVER,
    });
    expect(requested.map((url) => url.pathname)).toEqual(["/track/3135556"]);
  });

  it("answers null for an id Deezer does not know (error 800 inside an HTTP 200)", async () => {
    const { catalog } = fakeDeezer(() =>
      json({ error: { type: "DataException", code: 800 } }),
    );

    expect(await catalog.getTrack("1")).toBeNull();
  });

  it("answers null for an id Deezer calls an invalid query (error 600)", async () => {
    const { catalog } = fakeDeezer(() =>
      json({ error: { type: "InvalidQueryException", code: 600 } }),
    );

    expect(await catalog.getTrack("1")).toBeNull();
  });

  it.each([
    "abc",
    "",
    "12a",
    "../user/me",
    "1/../2",
    "1?x=y",
    "1 2",
    "-5",
    "1.5",
    "9".repeat(16),
    "٣٤",
  ])("never sends the id %j to Deezer: it cannot be a track id", async (id) => {
    const { catalog, requested } = fakeDeezer(() => json(rawTrack()));

    expect(await catalog.getTrack(id)).toBeNull();
    expect(requested).toEqual([]);
  });

  it.each([
    [
      "a quota error (code 4)",
      () => json({ error: { code: 4, message: "Quota limit exceeded" } }),
    ],
    ["an access error (code 300)", () => json({ error: { code: 300 } })],
    ["an error without a code", () => json({ error: {} })],
    // A perfectly valid track behind an error status must still be refused.
    ["HTTP 500", () => json(rawTrack(), 500)],
    ["HTTP 429", () => json(rawTrack(), 429)],
    ["an HTML page", () => new Response("<html>maintenance</html>", { status: 200 })],
    ["a track without a title", () => json(rawTrack({ title: undefined }))],
    ["a track with an empty title", () => json(rawTrack({ title: "  " }))],
    ["a track without an artist", () => json(rawTrack({ artist: undefined }))],
    ["a track with a negative duration", () => json(rawTrack({ duration: -1 }))],
    ["an answer that is not an object", () => json("hello")],
    ["an answer whose id is not a number", () => json(rawTrack({ id: "abc" }))],
  ])("reports the catalog as unavailable on %s", async (_label, respond) => {
    const { catalog } = fakeDeezer(respond);

    await expect(catalog.getTrack("3135556")).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it("reports the catalog as unavailable when the network fails or times out", async () => {
    for (const failure of [
      new TypeError("fetch failed"),
      new DOMException("timed out", "TimeoutError"),
    ]) {
      const catalog = createDeezerCatalog({
        fetch: (() => Promise.reject(failure)) as typeof fetch,
      });

      await expect(catalog.getTrack("3135556")).rejects.toBeInstanceOf(
        CatalogUnavailableError,
      );
    }
  });

  it("asks for a timeout on every request", async () => {
    let signal: AbortSignal | null | undefined;
    const catalog = createDeezerCatalog({
      fetch: ((_url: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return Promise.resolve(json(rawTrack()));
      }) as typeof fetch,
    });

    await catalog.getTrack("3135556");

    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the numeric id as a string and accepts an id given as a string", async () => {
    const { catalog } = fakeDeezer(() => json(rawTrack({ id: "3135556" })));

    expect((await catalog.getTrack("3135556"))?.providerTrackId).toBe("3135556");
  });
});

describe("cleaning what Deezer sends", () => {
  it("replaces control characters and collapses whitespace", async () => {
    const { catalog } = fakeDeezer(() =>
      json(
        rawTrack({
          title: "Bad\u0000Title\nWith\tBreaks ",
          artist: { name: "  Spaced    Out  " },
        }),
      ),
    );

    const track = await catalog.getTrack("1");

    expect(track?.title).toBe("Bad Title With Breaks");
    expect(track?.artist).toBe("Spaced Out");
    expect(track?.title.includes("\u0000")).toBe(false);
  });

  it("cuts a very long title to 500 characters without splitting an emoji", async () => {
    const { catalog } = fakeDeezer(() =>
      json(rawTrack({ title: "🎵".repeat(600), artist: { name: "a".repeat(900) } })),
    );

    const track = await catalog.getTrack("1");

    expect(Array.from(track!.title)).toHaveLength(500);
    expect(track!.title).not.toContain("�");
    expect(Array.from(track!.artist)).toHaveLength(500);
  });

  it("caps an absurd duration at one day and rounds a fractional one", async () => {
    const huge = fakeDeezer(() => json(rawTrack({ duration: 10_000_000 })));
    const fractional = fakeDeezer(() => json(rawTrack({ duration: 225.6 })));

    expect((await huge.catalog.getTrack("1"))?.durationSeconds).toBe(86_400);
    expect((await fractional.catalog.getTrack("1"))?.durationSeconds).toBe(226);
  });

  it("has no cover when Deezer gives none", async () => {
    const { catalog } = fakeDeezer(() => json(rawTrack({ album: undefined })));

    expect((await catalog.getTrack("1"))?.coverUrl).toBeNull();
  });
});

describe("cleanCoverUrl: only Deezer's own https image hosts", () => {
  it.each([
    COVER,
    "https://e-cdns-images.dzcdn.net/images/cover/x/250x250.jpg",
    "https://cdnt-images.dzcdn.net/a.jpg",
  ])("keeps %s", (url) => {
    expect(cleanCoverUrl(url)).toBe(url);
  });

  it.each([
    ["another host", "https://evil.example/cover.jpg"],
    ["plain http", "http://cdn-images.dzcdn.net/a.jpg"],
    ["a look-alike host", "https://evildzcdn.net/a.jpg"],
    [
      "Deezer's name inside another domain",
      "https://cdn-images.dzcdn.net.evil.example/a.jpg",
    ],
    [
      "credentials that hide the real host",
      "https://cdn-images.dzcdn.net@evil.example/a.jpg",
    ],
    ["credentials on the real host", "https://user:pass@cdn-images.dzcdn.net/a.jpg"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a protocol-relative URL", "//cdn-images.dzcdn.net/a.jpg"],
    ["a relative path", "/images/a.jpg"],
    ["text that is not a URL", "not a url"],
    ["an empty string", ""],
    ["a URL over 2048 characters", `https://cdn-images.dzcdn.net/${"a".repeat(2100)}`],
  ])("drops %s", (_label, url) => {
    expect(cleanCoverUrl(url)).toBeNull();
  });

  it("drops a missing value", () => {
    expect(cleanCoverUrl(undefined)).toBeNull();
  });
});

const PREVIEW =
  "https://cdnt-preview.dzcdn.net/api/1/1/6/a/2/0/6a2c.mp3?hdnea=exp=1793151181~acl=/api/1/1/6a2c.mp3*~data=user_id=0~hmac=abc";

describe("getPreview", () => {
  it("returns a fresh link to the sample, asking for the track itself", async () => {
    const { catalog, requested } = fakeDeezer(() => json(rawTrack({ preview: PREVIEW })));

    expect(await catalog.getPreview("3135556")).toEqual({ kind: "found", url: PREVIEW });
    expect(requested.map((url) => url.pathname)).toEqual(["/track/3135556"]);
  });

  it.each([
    ["an empty preview", { preview: "" }],
    ["no preview field", {}],
    ["a link on another host", { preview: "https://evil.example/a.mp3" }],
    ["a plain http link", { preview: "http://cdnt-preview.dzcdn.net/a.mp3" }],
  ])("says there is no sample for %s", async (_label, fields) => {
    const { catalog } = fakeDeezer(() => json(rawTrack(fields)));

    expect(await catalog.getPreview("3135556")).toEqual({ kind: "noPreview" });
  });

  it("says the track is unknown for Deezer's error 800, and for an id that cannot exist without asking", async () => {
    const { catalog, requested } = fakeDeezer(() =>
      json({ error: { type: "DataException", code: 800 } }),
    );

    expect(await catalog.getPreview("1")).toEqual({ kind: "unknownTrack" });
    expect(await catalog.getPreview("../search")).toEqual({ kind: "unknownTrack" });
    expect(requested).toHaveLength(1);
  });

  it("reports an outage, a quota error and an odd preview field as unavailable", async () => {
    const down = fakeDeezer(() => json({}, 503)).catalog;
    const quota = fakeDeezer(() => json({ error: { code: 4 } })).catalog;
    const odd = fakeDeezer(() => json(rawTrack({ preview: 42 }))).catalog;

    for (const catalog of [down, quota, odd])
      await expect(catalog.getPreview("3135556")).rejects.toBeInstanceOf(
        CatalogUnavailableError,
      );
  });
});

describe("cleanPreviewUrl: only Deezer's own https audio hosts", () => {
  it("keeps a signed sample link", () => {
    expect(cleanPreviewUrl(PREVIEW)).toBe(PREVIEW);
  });

  it.each([
    ["another host", "https://evil.example/a.mp3"],
    ["plain http", "http://cdnt-preview.dzcdn.net/a.mp3"],
    [
      "Deezer's name inside another domain",
      "https://cdnt-preview.dzcdn.net.evil.example/a.mp3",
    ],
    [
      "credentials that hide the real host",
      "https://cdnt-preview.dzcdn.net@evil.example/a.mp3",
    ],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an empty string", ""],
    ["a URL over 2048 characters", `https://cdnt-preview.dzcdn.net/${"a".repeat(2100)}`],
  ])("drops %s", (_label, url) => {
    expect(cleanPreviewUrl(url)).toBeNull();
  });
});

describe("search", () => {
  const body = (items: unknown[]) => ({ data: items, total: items.length });

  it("returns the tracks in Deezer's order", async () => {
    const { catalog } = fakeDeezer(() =>
      json(body([rawTrack({ id: 1, title: "One" }), rawTrack({ id: 2, title: "Two" })])),
    );

    const tracks = await catalog.search("daft punk", 10);

    expect(tracks.map((t) => t.title)).toEqual(["One", "Two"]);
  });

  it("sends the text and the limit as properly encoded query parameters", async () => {
    const { catalog, requested } = fakeDeezer(() => json(body([])));

    await catalog.search("rock & roll #1 é?x=y", 7);

    const url = requested[0]!;
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("rock & roll #1 é?x=y");
    expect(url.searchParams.get("limit")).toBe("7");
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "q"]);
  });

  it("keeps the limit between 1 and 25", async () => {
    const { catalog, requested } = fakeDeezer(() => json(body([])));

    await catalog.search("abc", 1000);
    await catalog.search("abc", 0);

    expect(requested.map((url) => url.searchParams.get("limit"))).toEqual(["25", "1"]);
  });

  it("returns an empty list when nothing matches", async () => {
    const { catalog } = fakeDeezer(() => json({ data: [], total: 0 }));

    expect(await catalog.search("zzzqqq", 10)).toEqual([]);
  });

  it("skips an unusable entry without hiding the others", async () => {
    const { catalog } = fakeDeezer(() =>
      json(
        body([
          rawTrack({ id: 1 }),
          { id: 2 },
          "garbage",
          null,
          rawTrack({ id: 3, title: "" }),
          rawTrack({ id: 4 }),
        ]),
      ),
    );

    const tracks = await catalog.search("abc", 10);

    expect(tracks.map((t) => t.providerTrackId)).toEqual(["1", "4"]);
  });

  it("drops a foreign cover but keeps the track", async () => {
    const { catalog } = fakeDeezer(() =>
      json(body([rawTrack({ album: { cover_medium: "https://evil.example/x.jpg" } })])),
    );

    const [track] = await catalog.search("abc", 10);

    expect(track?.coverUrl).toBeNull();
    expect(track?.title).toBe("Harder, Better, Faster, Stronger");
  });

  it.each([
    ["an error body (quota)", () => json({ error: { code: 4 } })],
    ["HTTP 500 with a valid list", () => json({ data: [rawTrack()], total: 1 }, 500)],
    ["an answer without a data list", () => json({ total: 0 })],
    ["a data field that is not a list", () => json({ data: "no" })],
    ["an HTML page", () => new Response("<html></html>")],
  ])("reports the catalog as unavailable on %s", async (_label, respond) => {
    const { catalog } = fakeDeezer(respond);

    await expect(catalog.search("abc", 10)).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it("never puts the search text or the URL in an error", async () => {
    const catalog = createDeezerCatalog({
      fetch: (() =>
        Promise.reject(
          new TypeError("fetch failed https://api.deezer.com/search?q=secret"),
        )) as typeof fetch,
    });

    const error = await catalog.search("secret", 10).catch((caught: Error) => caught);

    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).not.toContain("deezer.com");
  });
});
