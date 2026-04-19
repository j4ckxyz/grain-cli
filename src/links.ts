export function buildGrainLibraryUrl(did: string): string {
  return `https://grain.social/profile/${did}`;
}

export function buildGrainGalleryUrl(uri: string): string | undefined {
  const match = uri.match(/^at:\/\/(did:[^/]+)\/social\.grain\.gallery\/([^/]+)$/);
  if (!match) {
    return undefined;
  }

  const [, did, rkey] = match;
  return `https://grain.social/profile/${did}/gallery/${rkey}`;
}
