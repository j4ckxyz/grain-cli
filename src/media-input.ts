import type { MediaInput } from "./types";

export function looksLikeHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function normalizeLocalPathToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("@")) {
    return trimmed.slice(1).trim();
  }
  return trimmed;
}

export function parsePositionalMediaToken(value: string): MediaInput {
  const trimmed = value.trim();
  if (looksLikeHttpUrl(trimmed)) {
    return { kind: "url", value: trimmed };
  }
  return { kind: "path", value: normalizeLocalPathToken(trimmed) };
}

export function parseWizardMediaEntry(value: string): MediaInput {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Media entry cannot be empty.");
  }

  if (trimmed.startsWith("@")) {
    const pathValue = normalizeLocalPathToken(trimmed);
    if (!pathValue) {
      throw new Error("Use @<path> for local files, for example @photo.jpg or @./images/pic.png.");
    }
    return { kind: "path", value: pathValue };
  }

  if (looksLikeHttpUrl(trimmed)) {
    return { kind: "url", value: trimmed };
  }

  throw new Error("Use @<path> for local files or a full http/https URL.");
}
