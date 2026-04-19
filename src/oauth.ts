import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Agent } from "@atproto/api";
import {
  NodeOAuthClient,
  OAuthCallbackError,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedState,
  type NodeSavedStateStore,
  type OAuthSession,
} from "@atproto/oauth-client-node";
import { GrainError } from "./errors";
import { getConfigPath, loadConfig, saveConfig } from "./config";
import { buildGrainLibraryUrl } from "./links";

const LOOPBACK_ORIGIN = "http://localhost";
const GRAIN_REPO_SCOPES = [
  "repo:social.grain.actor.profile",
  "repo:social.grain.comment",
  "repo:social.grain.favorite",
  "repo:social.grain.gallery",
  "repo:social.grain.gallery.item",
  "repo:social.grain.graph.follow",
  "repo:social.grain.photo",
  "repo:social.grain.photo.exif",
  "repo:social.grain.story",
] as const;
const DEFAULT_SCOPE = ["atproto", "blob:image/*", ...GRAIN_REPO_SCOPES].join(" ");
const CALLBACK_PATH = "/callback";

type OAuthStores = {
  stateStore: NodeSavedStateStore;
  sessionStore: NodeSavedSessionStore;
};

type NativeOpenCommand = "open" | "xdg-open";

function configDir(): string {
  return dirname(getConfigPath());
}

function oauthStorePath(fileName: string): string {
  return join(configDir(), fileName);
}

async function readJsonStore<T>(path: string): Promise<Record<string, T>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }

  const raw = await file.text();
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw) as Record<string, T>;
}

async function writeJsonStore<T>(path: string, value: Record<string, T>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
  await chmod(path, 0o600);
}

function createFileStore<T>(path: string): {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
} {
  return {
    async get(key) {
      const state = await readJsonStore<T>(path);
      return state[key];
    },
    async set(key, value) {
      const state = await readJsonStore<T>(path);
      state[key] = value;
      await writeJsonStore(path, state);
    },
    async del(key) {
      const state = await readJsonStore<T>(path);
      delete state[key];
      await writeJsonStore(path, state);
    },
    async clear() {
      await writeJsonStore(path, {});
    },
  };
}

function makeStores(): OAuthStores {
  const stateStorePath = oauthStorePath("oauth-state.json");
  const sessionStorePath = oauthStorePath("oauth-sessions.json");

  const stateStore = createFileStore<NodeSavedState>(stateStorePath);
  const sessionStore = createFileStore<NodeSavedSession>(sessionStorePath);

  return {
    stateStore,
    sessionStore,
  };
}

function randomPort(): number {
  const min = 38000;
  const max = 48999;
  return min + (randomBytes(2).readUInt16BE(0) % (max - min));
}

function getOpenCommand(): NativeOpenCommand | undefined {
  if (process.platform === "darwin") {
    return "open";
  }
  if (process.platform === "linux") {
    return "xdg-open";
  }
  return undefined;
}

function buildLoopbackClientId(redirectUri: string, scope: string): string {
  const params = new URLSearchParams();
  params.set("redirect_uri", redirectUri);
  params.set("scope", scope);
  return `${LOOPBACK_ORIGIN}?${params.toString()}`;
}

function createClient(clientId: string, redirectUri: string, scope: string): NodeOAuthClient {
  const stores = makeStores();

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope,
      application_type: "native",
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    },
    stateStore: stores.stateStore,
    sessionStore: stores.sessionStore,
    requestLock: requestLocalLock,
  });
}

async function waitForOAuthCallback(expectedState: string, redirectPort: number, timeoutMs = 180000): Promise<URLSearchParams> {
  let resolveResult!: (params: URLSearchParams) => void;
  let rejectResult!: (error: Error) => void;

  const result = new Promise<URLSearchParams>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const timeout = setTimeout(() => {
    rejectResult(new GrainError("oauth_timeout", "OAuth login timed out.", "Run `grain login` and complete browser approval within 3 minutes."));
  }, timeoutMs);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: redirectPort,
    fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("Not found", { status: 404 });
        }

        const state = url.searchParams.get("state");
        if (state !== expectedState) {
          rejectResult(new GrainError("oauth_state_mismatch", "OAuth state mismatch. Login was rejected."));
          return new Response("State mismatch. You can close this tab.", { status: 400 });
        }

        resolveResult(url.searchParams);
        return new Response("Login complete. Return to terminal.", { status: 200 });
      } catch (error) {
        rejectResult(new GrainError("oauth_callback_error", error instanceof Error ? error.message : String(error)));
        return new Response("OAuth callback failed.", { status: 500 });
      }
    },
  });

  try {
    return await result;
  } finally {
    clearTimeout(timeout);
    server.stop(true);
  }
}

export type LoginOAuthResult = {
  did: string;
  handle: string;
  libraryUrl: string;
};

async function maybeOpenBrowser(url: string): Promise<void> {
  const cmd = getOpenCommand();
  if (!cmd) {
    return;
  }

  try {
    await Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" }).exited;
  } catch {
    // user can open manually
  }
}

async function describeRepoHandle(session: OAuthSession, did: string, fallbackHandle: string): Promise<string> {
  try {
    const profile = await new Agent(session).com.atproto.repo.describeRepo({ repo: did });
    return profile.data.handle || fallbackHandle;
  } catch {
    return fallbackHandle;
  }
}

function normalizeStoredOAuth(config: Awaited<ReturnType<typeof loadConfig>>): {
  activeDid: string;
  handle: string;
  clientId: string;
  redirectUri: string;
  scope: string;
} {
  const oauth = config?.oauth;
  if (!oauth) {
    throw new GrainError("not_logged_in", "No OAuth session found.", "Run `grain login` to authenticate.");
  }

  return {
    activeDid: oauth.activeDid,
    handle: oauth.handle,
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri || "http://127.0.0.1/callback",
    scope: oauth.scope || DEFAULT_SCOPE,
  };
}

export async function loginWithOAuth(handle: string): Promise<LoginOAuthResult> {
  const redirectPort = randomPort();
  const redirectUri = `http://127.0.0.1:${redirectPort}${CALLBACK_PATH}`;
  const scope = DEFAULT_SCOPE;
  const clientId = buildLoopbackClientId(redirectUri, scope);
  const oauthClient = createClient(clientId, redirectUri, scope);

  const state = randomBytes(16).toString("hex");
  const authorizeUrl = await oauthClient.authorize(handle, {
    scope,
    state,
  });

  console.log("Open the following URL to continue login:");
  console.log(authorizeUrl.toString());
  await maybeOpenBrowser(authorizeUrl.toString());

  const callbackParams = await waitForOAuthCallback(state, redirectPort);

  let session: OAuthSession;
  try {
    const result = await oauthClient.callback(callbackParams);
    session = result.session;
  } catch (error) {
    if (error instanceof OAuthCallbackError) {
      throw new GrainError("oauth_callback", error.message);
    }
    throw error;
  }

  const did = session.did;
  const resolvedHandle = await describeRepoHandle(session, did, handle);

  const config = await loadConfig();
  const nextConfig = {
    ...(config ?? {}),
    oauth: {
      activeDid: did,
      handle: resolvedHandle,
      clientId,
      redirectUri,
      scope,
      loginAt: new Date().toISOString(),
    },
  };
  await saveConfig(nextConfig);

  return {
    did,
    handle: resolvedHandle,
    libraryUrl: buildGrainLibraryUrl(did),
  };
}

export async function getAuthorizedAgent(forceRefresh = false): Promise<{ agent: Agent; did: string; handle: string }> {
  const config = await loadConfig();
  const oauth = normalizeStoredOAuth(config);

  const client = createClient(oauth.clientId, oauth.redirectUri, oauth.scope);
  let session: OAuthSession;
  try {
    session = await client.restore(oauth.activeDid, forceRefresh ? true : "auto");
  } catch (error) {
    throw new GrainError(
      "session_restore_failed",
      error instanceof Error ? error.message : String(error),
      "Run `grain login` again to refresh your OAuth session.",
    );
  }

  return {
    agent: new Agent(session),
    did: session.did,
    handle: oauth.handle,
  };
}

export async function logoutOAuth(): Promise<void> {
  const config = await loadConfig();
  if (!config?.oauth) {
    return;
  }

  const oauth = normalizeStoredOAuth(config);
  const client = createClient(oauth.clientId, oauth.redirectUri, oauth.scope);

  try {
    await client.revoke(oauth.activeDid);
  } catch {
    // ignore revoke errors, still clear local state
  }

  const nextConfig = {
    ...config,
    oauth: undefined,
  };
  await saveConfig(nextConfig);

  const statePath = oauthStorePath("oauth-state.json");
  const sessionPath = oauthStorePath("oauth-sessions.json");
  await rm(statePath, { force: true });
  await rm(sessionPath, { force: true });
}
