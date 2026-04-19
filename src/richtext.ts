import { resolveMentionDid, type RichTextFacet } from "./atproto";
import { GrainError } from "./errors";

const HASHTAG_REGEX = /(^|\s)#([A-Za-z0-9_]{1,64})\b/g;
const URL_REGEX = /https?:\/\/[^\s]+/g;
const MENTION_REGEX = /(^|\s)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function byteRange(text: string, startCodeUnit: number, endCodeUnit: number): { byteStart: number; byteEnd: number } {
  const startText = text.slice(0, startCodeUnit);
  const endText = text.slice(0, endCodeUnit);
  return {
    byteStart: utf8Length(startText),
    byteEnd: utf8Length(endText),
  };
}

export async function buildFacets(
  text: string,
  mentionResolver: (handle: string) => Promise<string> = resolveMentionDid,
): Promise<RichTextFacet[] | undefined> {
  if (!text) {
    return undefined;
  }

  if (text.length > 3000) {
    throw new GrainError("description_too_long", "Description is too long for reliable rich text parsing.", "Keep description under 3000 characters.");
  }

  const facets: RichTextFacet[] = [];

  for (const match of text.matchAll(URL_REGEX)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const range = byteRange(text, index, index + raw.length);
    facets.push({
      index: range,
      features: [
        {
          $type: "app.bsky.richtext.facet#link",
          uri: raw,
        },
      ],
    });
  }

  for (const match of text.matchAll(HASHTAG_REGEX)) {
    const prefix = match[1] ?? "";
    const tag = match[2];
    const full = match[0];
    const index = (match.index ?? 0) + prefix.length;
    const visible = full.slice(prefix.length);
    const range = byteRange(text, index, index + visible.length);
    facets.push({
      index: range,
      features: [
        {
          $type: "app.bsky.richtext.facet#tag",
          tag,
        },
      ],
    });
  }

  const mentionPromises: Array<Promise<RichTextFacet | null>> = [];
  for (const match of text.matchAll(MENTION_REGEX)) {
    const prefix = match[1] ?? "";
    const handle = match[2].toLowerCase();
    const full = match[0];
    const index = (match.index ?? 0) + prefix.length;
    const visible = full.slice(prefix.length);

    mentionPromises.push((async () => {
      try {
        const did = await mentionResolver(handle);
        const range = byteRange(text, index, index + visible.length);
        return {
          index: range,
          features: [
            {
              $type: "app.bsky.richtext.facet#mention",
              did,
            },
          ],
        } satisfies RichTextFacet;
      } catch {
        return null;
      }
    })());
  }

  const mentionFacets = await Promise.all(mentionPromises);
  for (const facet of mentionFacets) {
    if (facet) {
      facets.push(facet);
    }
  }

  facets.sort((a, b) => a.index.byteStart - b.index.byteStart || a.index.byteEnd - b.index.byteEnd);
  return facets.length > 0 ? facets : undefined;
}
