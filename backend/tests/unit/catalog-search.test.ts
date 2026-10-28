import { Writable } from "node:stream";
import type { Track } from "@music-room/shared";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createPostgresPool } from "../../src/db/postgres.js";
import { signAccessToken } from "../../src/modules/auth/access-token.js";
import {
  CatalogUnavailableError,
  type CatalogProvider,
  type PreviewLookup,
} from "../../src/modules/track-vote/catalog.js";

// GET /tracks/search through the real app with a FAKE catalog. The search touches no
// database (the pool is lazy and never connects), so this runs without Postgres.
const SECRET = "s".repeat(32);
const USER_ID = "3f2b8c1e-5d7a-4c1b-9a3e-2b1f6d8e7c90";

const track = (id: string): Track => ({
  providerTrackId: id,
  title: `Song ${id}`,
  artist: "Artist",
  durationSeconds: 200,
  coverUrl: null,
});

function build(catalog: CatalogProvider, overrides: Record<string, unknown> = {}) {
  const logLines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  const app = createApp({
    pool: createPostgresPool("postgres://nobody:nothing@localhost:1/none"),
    jwtSecret: SECRET,
    logger: pino({ level: "info" }, sink),
    catalog,
    ...overrides,
  });
  return { app, logLines };
}

const search = async (
  app: ReturnType<typeof build>["app"],
  query: string,
  authenticated = true,
) => {
  const req = request(app).get(`/api/v1/tracks/search?${query}`);
  if (authenticated)
    req.set(
      "Authorization",
      `Bearer ${await signAccessToken(USER_ID, SECRET, { displayNameSet: true })}`,
    );
  return req;
};

function recordingCatalog(result: Track[] = [track("1"), track("2")]) {
  const calls: { query: string; limit: number }[] = [];
  const catalog: CatalogProvider = {
    search: (query, limit) => {
      calls.push({ query, limit });
      return Promise.resolve(result);
    },
    getTrack: () => Promise.resolve(null),
    getPreview: () => Promise.resolve({ kind: "noPreview" }),
  };
  return { catalog, calls };
}

describe("GET /tracks/search", () => {
  it("requires authentication and never reaches the catalog without it", async () => {
    const { catalog, calls } = recordingCatalog();
    const { app } = build(catalog);

    const response = await search(app, "query=daft", false);

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("returns one page of tracks with no next cursor", async () => {
    const { catalog } = recordingCatalog();
    const { app } = build(catalog);

    const response = await search(app, "query=daft+punk");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ items: [track("1"), track("2")], nextCursor: null });
  });

  it("passes the trimmed text and the default limit of 10 to the catalog", async () => {
    const { catalog, calls } = recordingCatalog();
    const { app } = build(catalog);

    await search(app, `query=${encodeURIComponent("  daft punk  ")}`);
    await search(app, "query=daft&limit=25");

    expect(calls).toEqual([
      { query: "daft punk", limit: 10 },
      { query: "daft", limit: 25 },
    ]);
  });

  it("returns an empty page when nothing matches", async () => {
    const { catalog } = recordingCatalog([]);
    const { app } = build(catalog);

    const response = await search(app, "query=zzzzz");

    expect(response.body).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ["no query", ""],
    ["a 1-character query", "query=a"],
    ["a blank query", `query=${encodeURIComponent("   ")}`],
    ["a 101-character query", `query=${"x".repeat(101)}`],
    ["a limit of 0", "query=daft&limit=0"],
    ["a limit of 26", "query=daft&limit=26"],
    ["a limit that is not a number", "query=daft&limit=abc"],
  ])("answers 400 for %s without asking the catalog", async (_label, query) => {
    const { catalog, calls } = recordingCatalog();
    const { app } = build(catalog);

    const response = await search(app, query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(calls).toEqual([]);
  });

  it("answers 502 PROVIDER_UNAVAILABLE with a generic message when the catalog fails", async () => {
    const failing: CatalogProvider = {
      search: () => Promise.reject(new CatalogUnavailableError("Deezer answered 500")),
      getTrack: () => Promise.resolve(null),
      getPreview: () => Promise.resolve({ kind: "noPreview" }),
    };
    const { app, logLines } = build(failing);

    const response = await search(app, "query=secret+search");

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("Deezer");
    expect(logLines.join("")).toContain("music catalog unavailable");
    expect(logLines.join("")).not.toContain("secret search"); // the user's text is never logged
  });

  it("answers 502 when no catalog is configured", async () => {
    const { app } = build(undefined as unknown as CatalogProvider);

    const response = await search(app, "query=daft");

    expect(response.status).toBe(502);
  });

  it("does not turn an unexpected error into a 502", async () => {
    const broken: CatalogProvider = {
      search: () => Promise.reject(new Error("bug")),
      getTrack: () => Promise.resolve(null),
      getPreview: () => Promise.resolve({ kind: "noPreview" }),
    };
    const { app } = build(broken);

    expect((await search(app, "query=daft")).status).toBe(500);
  });

  it("is rate limited, and a rejected request does not reach the catalog", async () => {
    const { catalog, calls } = recordingCatalog();
    const { app } = build(catalog, {
      catalogSearchLimit: { windowMs: 60_000, limit: 2 },
    });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await search(app, "query=daft")).status);

    expect(statuses).toEqual([200, 200, 429]);
    expect(calls).toHaveLength(2);
  });
});

const PREVIEW_URL = "https://cdnt-preview.dzcdn.net/api/1/1/a.mp3?hdnea=exp=1~hmac=x";

function previewCatalog(answer: PreviewLookup | Error) {
  const calls: string[] = [];
  const catalog: CatalogProvider = {
    search: () => Promise.resolve([]),
    getTrack: () => Promise.resolve(null),
    getPreview: (id) => {
      calls.push(id);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { catalog, calls };
}

const preview = async (
  app: ReturnType<typeof build>["app"],
  id: string,
  authenticated = true,
) => {
  const req = request(app).get(`/api/v1/tracks/${id}/preview`);
  if (authenticated)
    req.set(
      "Authorization",
      `Bearer ${await signAccessToken(USER_ID, SECRET, { displayNameSet: true })}`,
    );
  return req;
};

describe("GET /tracks/{providerTrackId}/preview", () => {
  it("requires authentication and never reaches the catalog without it", async () => {
    const { catalog, calls } = previewCatalog({ kind: "found", url: PREVIEW_URL });
    const { app } = build(catalog);

    expect((await preview(app, "3135556", false)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("returns a fresh link that nothing may cache", async () => {
    const { catalog, calls } = previewCatalog({ kind: "found", url: PREVIEW_URL });
    const { app } = build(catalog);

    const response = await preview(app, "3135556");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({ url: PREVIEW_URL });
    expect(calls).toEqual(["3135556"]);
  });

  it("answers 404 PREVIEW_UNAVAILABLE for a track without a sample", async () => {
    const { app } = build(previewCatalog({ kind: "noPreview" }).catalog);

    const response = await preview(app, "3135556");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PREVIEW_UNAVAILABLE");
  });

  it("answers 404 TRACK_NOT_FOUND for a track the catalog does not know", async () => {
    const { app } = build(previewCatalog({ kind: "unknownTrack" }).catalog);

    const response = await preview(app, "1");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TRACK_NOT_FOUND");
  });

  it.each([
    ["dots", "1.5"],
    ["an encoded slash", "1%2F2"],
    ["65 characters", "1".repeat(65)],
  ])("answers 400 for an id with %s without asking the catalog", async (_label, id) => {
    const { catalog, calls } = previewCatalog({ kind: "found", url: PREVIEW_URL });
    const { app } = build(catalog);

    const response = await preview(app, id);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(calls).toEqual([]);
  });

  it("answers 502 PROVIDER_UNAVAILABLE with a generic message when the catalog fails", async () => {
    const { catalog } = previewCatalog(
      new CatalogUnavailableError("Deezer answered 500"),
    );
    const { app, logLines } = build(catalog);

    const response = await preview(app, "424242");

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toContain("Deezer");
    expect(logLines.join("")).toContain("music catalog unavailable");
  });

  it("is rate limited, and a rejected request does not reach the catalog", async () => {
    const { catalog, calls } = previewCatalog({ kind: "found", url: PREVIEW_URL });
    const { app } = build(catalog, { trackPreviewLimit: { windowMs: 60_000, limit: 2 } });

    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await preview(app, "3135556")).status);

    expect(statuses).toEqual([200, 200, 429]);
    expect(calls).toHaveLength(2);
  });
});
