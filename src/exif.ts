import exifr from "exifr";

const SCALE = 1_000_000;

export type GrainExifFields = {
  iSO?: number;
  make?: string;
  flash?: string;
  model?: string;
  fNumber?: number;
  lensMake?: string;
  lensModel?: string;
  exposureTime?: number;
  dateTimeOriginal?: string;
  focalLengthIn35mmFormat?: number;
};

type RawExif = Record<string, unknown>;

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scaledNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * SCALE);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes("/")) {
      const [numRaw, denRaw] = trimmed.split("/", 2);
      const num = Number(numRaw);
      const den = Number(denRaw);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
        return Math.round((num / den) * SCALE);
      }
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed * SCALE);
    }
  }

  return undefined;
}

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    const normalized = value
      .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
      .replace(/\s+/, "T");
    const reparsed = new Date(normalized);
    if (!Number.isNaN(reparsed.getTime())) {
      return reparsed.toISOString();
    }
  }

  return undefined;
}

function flashDescription(value: unknown): string | undefined {
  if (typeof value === "string") {
    return cleanString(value);
  }

  if (value && typeof value === "object") {
    const maybeDescription = (value as Record<string, unknown>).description;
    if (typeof maybeDescription === "string") {
      return cleanString(maybeDescription);
    }
  }

  return undefined;
}

export function mapExifToGrainFields(raw: RawExif): GrainExifFields | undefined {
  const fields: GrainExifFields = {
    make: cleanString(raw.Make),
    model: cleanString(raw.Model),
    lensMake: cleanString(raw.LensMake),
    lensModel: cleanString(raw.LensModel),
    flash: flashDescription(raw.Flash),
    iSO: scaledNumber(raw.ISO ?? raw.PhotographicSensitivity),
    fNumber: scaledNumber(raw.FNumber),
    exposureTime: scaledNumber(raw.ExposureTime),
    focalLengthIn35mmFormat: scaledNumber(raw.FocalLengthIn35mmFormat),
    dateTimeOriginal: toIsoDate(raw.DateTimeOriginal),
  };

  const hasAny = Object.values(fields).some((value) => value !== undefined);
  return hasAny ? fields : undefined;
}

export async function extractGrainExifFields(bytes: Uint8Array): Promise<GrainExifFields | undefined> {
  let raw: unknown;
  try {
    raw = await exifr.parse(Buffer.from(bytes));
  } catch {
    return undefined;
  }

  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  return mapExifToGrainFields(raw as RawExif);
}
