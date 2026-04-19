import type { RichTextFacet } from "./types";

type RequestOptions = {
  method?: string;
  body?: unknown;
  jwt?: string;
  contentType?: string;
};

type ResolveHandleResponse = {
  did: string;
};

type PlcDocument = {
  service?: Array<{
    id?: string;
    type?: string;
    serviceEndpoint?: string;
  }>;
};

function ensureOk(response: Response, text: string): void {
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
}

export async function xrpc<T>(baseUrl: string, nsid: string, options: RequestOptions = {}): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}/xrpc/${nsid}`;
  const headers = new Headers();

  if (options.jwt) {
    headers.set("Authorization", `Bearer ${options.jwt}`);
  }

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    const contentType = options.contentType ?? "application/json";
    headers.set("Content-Type", contentType);
    if (contentType === "application/json") {
      body = JSON.stringify(options.body);
    } else if (typeof options.body === "string" || options.body instanceof Uint8Array || options.body instanceof ArrayBuffer) {
      body = options.body as BodyInit;
    } else {
      throw new Error(`Unsupported body for content-type ${contentType}`);
    }
  }

  const response = await fetch(url, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
  });

  const text = await response.text();
  ensureOk(response, text);

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export async function resolveHandleToDid(handle: string): Promise<string> {
  const data = await xrpc<ResolveHandleResponse>(
    "https://public.api.bsky.app",
    `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
  );
  return data.did;
}

export async function resolveDidToPds(did: string): Promise<string> {
  const response = await fetch(`https://plc.directory/${encodeURIComponent(did)}`);
  const text = await response.text();
  ensureOk(response, text);
  const doc = JSON.parse(text) as PlcDocument;
  const service = doc.service?.find((entry) => entry.id === "#atproto_pds")
    ?? doc.service?.find((entry) => entry.type === "AtprotoPersonalDataServer");

  if (!service?.serviceEndpoint) {
    throw new Error(`Could not resolve PDS endpoint for DID ${did}`);
  }

  return service.serviceEndpoint;
}

export async function resolveMentionDid(handle: string): Promise<string> {
  return resolveHandleToDid(handle);
}

export function buildSelfLabels(contentWarnings: string[] | undefined):
  | {
      $type: "com.atproto.label.defs#selfLabels";
      values: Array<{ val: string }>;
    }
  | undefined {
  if (!contentWarnings || contentWarnings.length === 0) {
    return undefined;
  }

  return {
    $type: "com.atproto.label.defs#selfLabels",
    values: contentWarnings.map((val) => ({ val })),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export type { RichTextFacet };
