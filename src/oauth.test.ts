import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";
import type { AppConfig } from "./types";

describe("oauth config shape", () => {
  test("type allows oauth fields", () => {
    const config: AppConfig = {
      oauth: {
        activeDid: "did:plc:abc",
        handle: "j4ck.xyz",
        clientId: "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback&scope=atproto",
        redirectUri: "http://127.0.0.1:1234/callback",
        scope: "atproto repo:social.grain.* blob:image/*",
        loginAt: new Date().toISOString(),
      },
    };

    expect(config.oauth?.activeDid).toBe("did:plc:abc");
  });

  test("loadConfig remains callable", () => {
    expect(typeof loadConfig).toBe("function");
  });
});
