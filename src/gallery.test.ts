import { describe, expect, test } from "bun:test";
import { parseContentWarnings, validateUploadOptions } from "./gallery";
import type { MediaInput } from "./types";

const agent = {} as unknown;
const did = "did:plc:123";

describe("parseContentWarnings", () => {
  test("normalizes comma-separated labels", () => {
    expect(parseContentWarnings(" nudity, sexual , nudity ")).toEqual(["nudity", "sexual"]);
  });

  test("returns empty list for undefined", () => {
    expect(parseContentWarnings(undefined)).toEqual([]);
  });
});

describe("validateUploadOptions", () => {
  const onePathMedia: MediaInput[] = [{ kind: "path", value: "a.jpg" }];

  test("rejects empty title", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "   ",
        mediaInputs: onePathMedia,
      }),
    ).toThrow("--title is required.");
  });

  test("rejects when no images", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [],
      }),
    ).toThrow("Provide at least one image");
  });

  test("rejects more than 20 images", () => {
    const mediaInputs: MediaInput[] = Array.from({ length: 21 }, (_, i) => ({ kind: "path", value: `${i}.jpg` }));
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs,
      }),
    ).toThrow("at most 20 images");
  });

  test("requires location name/value pair", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: onePathMedia,
        locationName: "St Ouen",
      }),
    ).toThrow("must be provided together");
  });

  test("rejects invalid image URL", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [{ kind: "url", value: "notaurl" }],
      }),
    ).toThrow("Invalid image URL");
  });

  test("rejects non-http image URL", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [{ kind: "url", value: "ftp://example.com/a.jpg" }],
      }),
    ).toThrow("must use http or https");
  });

  test("accepts valid shape", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [
          { kind: "path", value: "a.jpg" },
          { kind: "url", value: "https://example.com/a.jpg" },
        ],
        locationName: "St Ouen",
        locationValue: "8a1862806aa7fff",
        exifMode: "include",
      }),
    ).not.toThrow();
  });

  test("rejects invalid exif mode", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [{ kind: "path", value: "a.jpg" }],
        exifMode: "invalid" as "include",
      }),
    ).toThrow("--exif must be either");
  });

  test("accepts exclude exif mode", () => {
    expect(() =>
      validateUploadOptions({
        agent: agent as never,
        did,
        title: "hello",
        mediaInputs: [{ kind: "path", value: "a.jpg" }],
        exifMode: "exclude",
      }),
    ).not.toThrow();
  });
});
