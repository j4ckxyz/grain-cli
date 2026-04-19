import { describe, expect, test } from "bun:test";
import { normalizeLocalPathToken, parsePositionalMediaToken, parseWizardMediaEntry } from "./media-input";

describe("parsePositionalMediaToken", () => {
  test("parses URL as url kind", () => {
    expect(parsePositionalMediaToken("https://example.com/a.jpg")).toEqual({
      kind: "url",
      value: "https://example.com/a.jpg",
    });
  });

  test("parses plain token as path kind", () => {
    expect(parsePositionalMediaToken("a.jpg")).toEqual({
      kind: "path",
      value: "a.jpg",
    });
  });

  test("parses @ token as path kind", () => {
    expect(parsePositionalMediaToken("@a.jpg")).toEqual({
      kind: "path",
      value: "a.jpg",
    });
  });
});

describe("parseWizardMediaEntry", () => {
  test("requires @ for local path", () => {
    expect(() => parseWizardMediaEntry("photo.jpg")).toThrow("Use @<path>");
  });

  test("parses @ path", () => {
    expect(parseWizardMediaEntry("@./photo.jpg")).toEqual({
      kind: "path",
      value: "./photo.jpg",
    });
  });

  test("parses URL", () => {
    expect(parseWizardMediaEntry("https://example.com/photo.jpg")).toEqual({
      kind: "url",
      value: "https://example.com/photo.jpg",
    });
  });
});

describe("normalizeLocalPathToken", () => {
  test("removes @ prefix", () => {
    expect(normalizeLocalPathToken("@./photo.jpg")).toBe("./photo.jpg");
  });

  test("leaves plain path unchanged", () => {
    expect(normalizeLocalPathToken("./photo.jpg")).toBe("./photo.jpg");
  });
});
