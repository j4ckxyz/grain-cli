import { describe, expect, test } from "bun:test";
import { buildGrainGalleryUrl, buildGrainLibraryUrl } from "./links";

describe("buildGrainLibraryUrl", () => {
  test("returns profile URL", () => {
    expect(buildGrainLibraryUrl("did:plc:abc")).toBe("https://grain.social/profile/did:plc:abc");
  });
});

describe("buildGrainGalleryUrl", () => {
  test("returns gallery URL for gallery AT-URI", () => {
    expect(buildGrainGalleryUrl("at://did:plc:abc/social.grain.gallery/3m123")).toBe(
      "https://grain.social/profile/did:plc:abc/gallery/3m123",
    );
  });

  test("returns undefined for non-gallery URI", () => {
    expect(buildGrainGalleryUrl("at://did:plc:abc/social.grain.photo/3m123")).toBeUndefined();
  });
});
