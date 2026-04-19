export type OAuthConfig = {
  activeDid: string;
  handle: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  loginAt: string;
};

export type AppConfig = {
  oauth?: OAuthConfig;
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
};
