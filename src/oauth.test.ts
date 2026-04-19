import { describe, expect, mock, test } from "bun:test";
import { loadConfig } from "./config";
import type { AppConfig } from "./types";
import { loginWithOAuth } from "./oauth";

const serveMock = mock((options?: { fetch: (request: Request) => Response }) => {
  void options;
  return {
    stop: () => {},
  };
});

const spawnMock = mock(() => ({
  exited: Promise.resolve(0),
}));

const randomBytesMock = mock((size: number) => {
  if (size === 2) {
    return Buffer.from([0x00, 0x01]);
  }
  if (size === 16) {
    return Buffer.alloc(16, 0xab);
  }
  return Buffer.alloc(size, 0);
});

const oauthClientState = {
  authorizeState: undefined as string | undefined,
  callbackParams: undefined as URLSearchParams | undefined,
};

const authorizeMock = mock(async (_input: string, options?: { state?: string }) => {
  oauthClientState.authorizeState = options?.state;
  return new URL("https://example.com/oauth/authorize");
});

const callbackMock = mock(async (params: URLSearchParams) => {
  oauthClientState.callbackParams = params;
  return {
    session: { did: "did:plc:test" },
    state: oauthClientState.authorizeState ?? null,
  };
});

const restoreMock = mock(async () => {
  throw new Error("not used in tests");
});

const revokeMock = mock(async () => {});

const describeRepoMock = mock(async () => ({
  data: {
    handle: "j4ck.xyz",
  },
}));

mock.module("node:crypto", () => ({
  randomBytes: randomBytesMock,
}));

mock.module("@atproto/oauth-client-node", () => ({
  NodeOAuthClient: class {
    authorize = authorizeMock;
    callback = callbackMock;
    restore = restoreMock;
    revoke = revokeMock;
  },
  OAuthCallbackError: class OAuthCallbackError extends Error {},
  requestLocalLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));

mock.module("@atproto/api", () => ({
  Agent: class Agent {
    did = "did:plc:test";
    com = {
      atproto: {
        repo: {
          describeRepo: describeRepoMock,
        },
      },
    };
  },
}));

const bunAny = Bun as unknown as {
  serve: typeof Bun.serve;
  spawn: typeof Bun.spawn;
};

bunAny.serve = serveMock as unknown as typeof Bun.serve;
bunAny.spawn = spawnMock as unknown as typeof Bun.spawn;

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

  test("login validates app state via oauth callback result", async () => {
    const servedRequest = new Request("http://127.0.0.1:38001/callback?code=abc123&state=oauth-generated-state");
    const fakeServer = {
      stop: () => {},
    };

    serveMock.mockImplementationOnce((options?: { fetch: (request: Request) => Response }) => {
      if (!options) {
        throw new Error("Missing Bun.serve options in test");
      }
      setTimeout(() => {
        options.fetch(servedRequest);
      }, 0);
      return fakeServer;
    });

    const result = await loginWithOAuth("j4ck.xyz");

    expect(result.did).toBe("did:plc:test");
    expect(oauthClientState.callbackParams?.get("state")).toBe("oauth-generated-state");
    expect(oauthClientState.authorizeState).toBe("abababababababababababababababab");
  });

  test("login rejects when oauth callback app state mismatches", async () => {
    const servedRequest = new Request("http://127.0.0.1:38001/callback?code=abc123&state=oauth-generated-state");
    const fakeServer = {
      stop: () => {},
    };

    serveMock.mockImplementationOnce((options?: { fetch: (request: Request) => Response }) => {
      if (!options) {
        throw new Error("Missing Bun.serve options in test");
      }
      callbackMock.mockImplementationOnce(async (_params: URLSearchParams) => ({
        session: { did: "did:plc:test" },
        state: "wrong-state",
      }));

      setTimeout(() => {
        options.fetch(servedRequest);
      }, 0);
      return fakeServer;
    });

    await expect(loginWithOAuth("j4ck.xyz")).rejects.toMatchObject({
      code: "oauth_state_mismatch",
    });
  });
});
