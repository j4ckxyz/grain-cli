export type OAuthConfig = {
  activeDid: string;
  handle: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  loginAt: string;
};

export type AltAiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AltAiAuthConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort: AltAiReasoningEffort;
  showReasoning: boolean;
};

export type PostingStyle = {
  name: string;
  description?: string;
  locationName?: string;
  locationValue?: string;
  placeName?: string;
  street?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  cw?: string;
  exifMode?: "include" | "exclude";
};

export type AppConfig = {
  oauth?: OAuthConfig;
  styles?: PostingStyle[];
  altAi?: AltAiAuthConfig;
};

export type RichTextFacet = {
  index: {
    byteStart: number;
    byteEnd: number;
  };
  features: Array<
    | {
        $type: "app.bsky.richtext.facet#mention";
        did: string;
      }
    | {
        $type: "app.bsky.richtext.facet#link";
        uri: string;
      }
    | {
        $type: "app.bsky.richtext.facet#tag";
        tag: string;
      }
  >;
};

export type UploadedBlob = {
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
  $type: "blob";
};

export type MediaInput = {
  kind: "path" | "url";
  value: string;
};

export type AltAiConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  reasoningEffort?: AltAiReasoningEffort;
  showReasoning?: boolean;
};
