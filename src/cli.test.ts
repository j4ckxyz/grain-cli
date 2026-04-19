import { describe, expect, test } from "bun:test";
import { parseArgs, hasOption } from "./args";

describe("login command argument guard", () => {
  test("detects legacy app-password option", () => {
    const parsed = parseArgs(["--handle", "j4ck.xyz", "--app-password", "xxx"]);
    expect(hasOption(parsed.options, "app-password")).toBe(true);
  });

  test("detects legacy pds option", () => {
    const parsed = parseArgs(["--handle", "j4ck.xyz", "--pds", "https://example.com"]);
    expect(hasOption(parsed.options, "pds")).toBe(true);
  });
});
