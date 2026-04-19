import { resolve } from "node:path";
import { Agent } from "@atproto/api";
import { imageSize } from "image-size";
import { buildFacets } from "./richtext";
import { buildSelfLabels, nowIso } from "./atproto";
import { generateAltTextFromImage } from "./alt-ai";
import { GrainError } from "./errors";
import { extractGrainExifFields, type GrainExifFields } from "./exif";
import { stripImageMetadata } from "./image-metadata";
import { detectImageMime, detectImageMimeFromUrl } from "./mime";
import type { AltAiConfig, MediaInput } from "./types";

export type GalleryAddress = {
  name?: string;
  street?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

export type UploadGalleryOptions = {
  agent: Agent;
  did: string;
  title: string;
  description?: string;
  locationName?: string;
  locationValue?: string;
  address?: GalleryAddress;
  contentWarnings?: string[];
  mediaInputs: MediaInput[];
  altTexts?: string[];
  altAi?: AltAiConfig;
  exifMode?: "include" | "exclude";
  onAltTextNeeded?: (context: {
    index: number;
    total: number;
    sourceKind: MediaInput["kind"];
    sourceValue: string;
    sourceLabel: string;
    bytes: Uint8Array;
    mimeType: string;
    reason: "missing" | "ai_failed";
    errorMessage?: string;
  }) => Promise<string | undefined>;
};

export type UploadGalleryResult = {
  galleryUri: string;
  photoUris: string[];
};

function clean(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanAddress(address: GalleryAddress | undefined): GalleryAddress | undefined {
  if (!address) {
    return undefined;
  }

  const cleaned: GalleryAddress = {
    name: clean(address.name),
    street: clean(address.street),
    locality: clean(address.locality),
    region: clean(address.region),
    postalCode: clean(address.postalCode),
    country: clean(address.country),
  };

  const hasAny = Object.values(cleaned).some((value) => value !== undefined);
  return hasAny ? cleaned : undefined;
}

export function parseContentWarnings(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const normalized = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.toLowerCase());

  return [...new Set(normalized)];
}

export function validateUploadOptions(options: UploadGalleryOptions): void {
  const title = clean(options.title);
  if (!title) {
    throw new GrainError("missing_title", "--title is required.");
  }

  if (options.mediaInputs.length === 0) {
    throw new GrainError("missing_media", "Provide at least one image with positional args, --image, or --image-url.");
  }

  if (options.mediaInputs.length > 20) {
    throw new GrainError("too_many_media", "A single gallery supports at most 20 images.");
  }

  const locationName = clean(options.locationName);
  const locationValue = clean(options.locationValue);
  if ((locationName && !locationValue) || (!locationName && locationValue)) {
    throw new GrainError("invalid_location", "--location-name and --location-value must be provided together.");
  }

  const exifMode = options.exifMode ?? "include";
  if (exifMode !== "include" && exifMode !== "exclude") {
    throw new GrainError("invalid_exif_mode", "--exif must be either 'include' or 'exclude'.");
  }

  for (const media of options.mediaInputs) {
    if (media.kind === "url") {
      let parsed: URL;
      try {
        parsed = new URL(media.value);
      } catch {
        throw new GrainError("invalid_image_url", `Invalid image URL: ${media.value}`);
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new GrainError("invalid_image_url_protocol", `Image URL must use http or https: ${media.value}`);
      }
    }
  }
}

type PreparedMedia = {
  sourceKind: MediaInput["kind"];
  sourceValue: string;
  sourceLabel: string;
  originalBytes: Uint8Array;
  mimeType: string;
};

type PreparedUpload = PreparedMedia & {
  bytes: Uint8Array;
  width: number;
  height: number;
  alt?: string;
  exif?: GrainExifFields;
};

async function loadMediaInput(media: MediaInput): Promise<PreparedMedia> {
  if (media.kind === "path") {
    const imagePath = resolve(media.value);
    const file = Bun.file(imagePath);
    if (!(await file.exists())) {
      throw new GrainError("image_not_found", `Image not found: ${imagePath}`);
    }

    const mimeType = detectImageMime(imagePath, file.type);
    if (!mimeType.startsWith("image/")) {
      throw new GrainError("unsupported_media_type", `Unsupported media type for ${imagePath}: ${mimeType}`);
    }

    return {
      sourceKind: "path",
      sourceValue: media.value,
      sourceLabel: imagePath,
      originalBytes: new Uint8Array(await file.arrayBuffer()),
      mimeType,
    };
  }

  const response = await fetch(media.value);
  const responseText = response.ok ? "" : await response.text();
  if (!response.ok) {
    throw new GrainError(
      "download_failed",
      `Could not download image URL (${response.status}): ${media.value} ${responseText}`.trim(),
    );
  }

  const mimeType = detectImageMimeFromUrl(media.value, response.headers.get("content-type"));
  if (!mimeType.startsWith("image/")) {
    throw new GrainError("download_not_image", `Downloaded URL is not an image: ${media.value} (${mimeType})`);
  }

  return {
    sourceKind: "url",
    sourceValue: media.value,
    sourceLabel: media.value,
    originalBytes: new Uint8Array(await response.arrayBuffer()),
    mimeType,
  };
}

export async function uploadGallery(options: UploadGalleryOptions): Promise<UploadGalleryResult> {
  validateUploadOptions(options);

  const title = clean(options.title)!;
  const description = clean(options.description);
  const address = cleanAddress(options.address);
  const locationName = clean(options.locationName);
  const locationValue = clean(options.locationValue);
  const contentWarnings = options.contentWarnings ?? [];
  const exifMode = options.exifMode ?? "include";

  const preparedUploads: PreparedUpload[] = [];
  for (let index = 0; index < options.mediaInputs.length; index += 1) {
    const media = await loadMediaInput(options.mediaInputs[index]);

    let uploadBytes = media.originalBytes;
    let exif: GrainExifFields | undefined;
    if (exifMode === "include") {
      exif = await extractGrainExifFields(media.originalBytes);
    } else {
      uploadBytes = await stripImageMetadata(media.originalBytes, media.mimeType);
    }

    const dimensions = imageSize(Buffer.from(uploadBytes));
    if (!dimensions.width || !dimensions.height) {
      throw new GrainError("image_dimensions_failed", `Could not read image dimensions for ${media.sourceLabel}`);
    }

    let alt = clean(options.altTexts?.[index]);
    if (!alt && options.altAi) {
      try {
        alt = await generateAltTextFromImage(options.altAi, uploadBytes, media.mimeType);
        console.log(`Generated alt text for ${media.sourceLabel}`);
      } catch (error) {
        if (!options.onAltTextNeeded) {
          throw error;
        }

        alt = clean(await options.onAltTextNeeded({
          index,
          total: options.mediaInputs.length,
          sourceKind: media.sourceKind,
          sourceValue: media.sourceValue,
          sourceLabel: media.sourceLabel,
          bytes: uploadBytes,
          mimeType: media.mimeType,
          reason: "ai_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    if (!alt && options.onAltTextNeeded && !options.altAi) {
      alt = clean(await options.onAltTextNeeded({
        index,
        total: options.mediaInputs.length,
        sourceKind: media.sourceKind,
        sourceValue: media.sourceValue,
        sourceLabel: media.sourceLabel,
        bytes: uploadBytes,
        mimeType: media.mimeType,
        reason: "missing",
      }));
    }

    preparedUploads.push({
      ...media,
      bytes: uploadBytes,
      width: dimensions.width,
      height: dimensions.height,
      alt,
      exif,
    });
  }

  const facets = description ? await buildFacets(description) : undefined;
  const labels = buildSelfLabels(contentWarnings);

  const galleryRecord: Record<string, unknown> = {
    $type: "social.grain.gallery",
    title,
    createdAt: nowIso(),
  };

  if (description) {
    galleryRecord.description = description;
  }
  if (facets && facets.length > 0) {
    galleryRecord.facets = facets;
  }
  if (address) {
    galleryRecord.address = address;
  }
  if (locationName && locationValue) {
    galleryRecord.location = {
      name: locationName,
      value: locationValue,
    };
  }
  if (labels) {
    galleryRecord.labels = labels;
  }

  const gallery = await options.agent.com.atproto.repo.createRecord({
    repo: options.did,
    collection: "social.grain.gallery",
    record: galleryRecord,
  });

  const photoUris: string[] = [];

  for (let index = 0; index < preparedUploads.length; index += 1) {
    const media = preparedUploads[index];
    const blob = (await options.agent.com.atproto.repo.uploadBlob(media.bytes, {
      encoding: media.mimeType,
    })).data.blob;

    const photoRecord: Record<string, unknown> = {
      $type: "social.grain.photo",
      photo: blob,
      aspectRatio: {
        width: media.width,
        height: media.height,
      },
      createdAt: nowIso(),
    };

    if (media.alt) {
      photoRecord.alt = media.alt;
    }

    const createdPhoto = await options.agent.com.atproto.repo.createRecord({
      repo: options.did,
      collection: "social.grain.photo",
      record: photoRecord,
    });

    photoUris.push(createdPhoto.data.uri);

    await options.agent.com.atproto.repo.createRecord({
      repo: options.did,
      collection: "social.grain.gallery.item",
      record: {
        $type: "social.grain.gallery.item",
        gallery: gallery.data.uri,
        item: createdPhoto.data.uri,
        position: index,
        createdAt: nowIso(),
      },
    });

    if (exifMode === "include" && media.exif) {
      await options.agent.com.atproto.repo.createRecord({
        repo: options.did,
        collection: "social.grain.photo.exif",
        record: {
          $type: "social.grain.photo.exif",
          photo: createdPhoto.data.uri,
          ...media.exif,
          createdAt: nowIso(),
        },
      });
    }
  }

  return {
    galleryUri: gallery.data.uri,
    photoUris,
  };
}
