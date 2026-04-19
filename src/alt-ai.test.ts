import { describe, expect, test } from "bun:test";
import { sanitizeGeneratedAltText } from "./alt-ai";

describe("sanitizeGeneratedAltText", () => {
  test("normalizes punctuation and strips non-ascii", () => {
    const input = "Curly quotes “smart” with emoji 😀 and café signage";
    const output = sanitizeGeneratedAltText(input);
    expect(output).toBe('Curly quotes "smart" with emoji and cafe signage');
  });

  test("enforces hard length cap", () => {
    const input = "a".repeat(300);
    const output = sanitizeGeneratedAltText(input);
    expect(output.length).toBeLessThanOrEqual(220);
  });
});
