import { describe, expect, it } from "vitest";
import { CatalogUnavailableError } from "../../src/modules/track-vote/catalog.js";
import { createFakeCatalog } from "../../src/modules/track-vote/fake-catalog.js";

// The fake catalog is for load tests only; these tests pin down what the harness relies on.
describe("fake catalog", () => {
  const catalog = createFakeCatalog();

  it("knows every numeric id and answers the same thing every time", async () => {
    const first = await catalog.getTrack("42");

    expect(first).toEqual({
      providerTrackId: "42",
      title: "Fake track 42",
      artist: "Fake artist",
      durationSeconds: 180 + 42,
      coverUrl: null,
    });
    expect(await catalog.getTrack("42")).toEqual(first);
  });

  it.each(["0", "abc", "", "1.5", "../x", "9".repeat(16)])(
    "does not know the id %j",
    async (id) => {
      expect(await catalog.getTrack(id)).toBeNull();
    },
  );

  it("can simulate an outage with one special id", async () => {
    await expect(catalog.getTrack("999999999")).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    );
  });

  it("returns the requested number of results, between 1 and 25, with the query in the title", async () => {
    const some = await catalog.search("daft", 3);

    expect(some).toHaveLength(3);
    expect(some[0]!.title).toContain("daft");
    expect(await catalog.search("x", 1000)).toHaveLength(25);
    expect(await catalog.search("x", 0)).toHaveLength(1);
  });
});
