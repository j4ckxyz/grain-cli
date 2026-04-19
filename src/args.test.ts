import { describe, expect, test } from "bun:test";
import { getOption, getOptionList, parseArgs } from "./args";

describe("parseArgs", () => {
  test("parses positional and key-value options", () => {
    const parsed = parseArgs([
      "--title",
      "Hello",
      "--description=World",
      "image1.jpg",
      "image2.jpg",
    ]);

    expect(parsed.positional).toEqual(["image1.jpg", "image2.jpg"]);
    expect(getOption(parsed.options, "title")).toBe("Hello");
    expect(getOption(parsed.options, "description")).toBe("World");
  });

  test("collects repeated options", () => {
    const parsed = parseArgs([
      "--image",
      "a.jpg",
      "--image",
      "b.jpg",
      "--image=c.jpg",
    ]);

    expect(getOptionList(parsed.options, "image")).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  test("treats option without value as true flag", () => {
    const parsed = parseArgs(["--json"]);
    expect(getOption(parsed.options, "json")).toBe("true");
  });
});
