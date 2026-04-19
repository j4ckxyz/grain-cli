import { extname } from "node:path";

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
};

export function detectImageMime(path: string, bunFileType: string): string {
  if (bunFileType && bunFileType.startsWith("image/")) {
    return bunFileType;
  }

  const ext = extname(path).toLowerCase();
  const mapped = EXT_TO_MIME[ext];
  if (mapped) {
    return mapped;
  }

  return bunFileType || "application/octet-stream";
}

export function detectImageMimeFromUrl(url: string, headerType: string | null): string {
  const normalizedHeader = (headerType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalizedHeader.startsWith("image/")) {
    return normalizedHeader;
  }

  try {
    const parsed = new URL(url);
    return detectImageMime(parsed.pathname, normalizedHeader);
  } catch {
    return detectImageMime(url, normalizedHeader);
  }
}
