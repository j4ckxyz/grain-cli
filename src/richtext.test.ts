import { describe, expect, test, mock } from "bun:test";

describe("buildFacets", () => {
  test("creates hashtag and link facets with byte ranges", async () => {
    const { buildFacets } = await import("./richtext");
    const text = "Look #Grain at https://grain.social";
    const facets = await buildFacets(text);

    expect(facets).toBeDefined();
    expect(facets?.length).toBe(2);

    const [tagFacet, linkFacet] = facets ?? [];
    expect(tagFacet.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#tag",
      tag: "Grain",
    });
    expect(linkFacet.features[0]).toEqual({
      $type: "app.bsky.richtext.facet#link",
      uri: "https://grain.social",
    });
  });

  test("creates mention facets and tolerates unresolved handles", async () => {
    const spy = mock(async (handle: string) => {
      if (handle === "ok.test") {
        return "did:plc:ok";
      }
      throw new Error("not found");
    });

    const { buildFacets } = await import("./richtext");
    const facets = await buildFacets("hello @ok.test @missing.test", spy);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(facets?.length).toBe(1);
    expect(facets?.[0].features[0]).toEqual({
      $type: "app.bsky.richtext.facet#mention",
      did: "did:plc:ok",
    });
  });

  test("uses UTF-8 byte offsets", async () => {
    const { buildFacets } = await import("./richtext");
    const facets = await buildFacets("ok 😀 #tag");
    expect(facets?.length).toBe(1);
    expect(facets?.[0].index).toEqual({
      byteStart: 8,
      byteEnd: 12,
    });
  });
});
