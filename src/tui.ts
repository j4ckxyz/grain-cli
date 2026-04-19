import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrainError } from "./errors";
import { parseWizardMediaEntry } from "./media-input";
import type { AltAiConfig, MediaInput } from "./types";

type Prompt = {
  askText(message: string, options?: { allowEmpty?: boolean; defaultValue?: string }): Promise<string>;
  askYesNo(message: string, defaultYes?: boolean): Promise<boolean>;
};

const FOCUS_FRAMES = ["[focus: .  ]", "[focus: .. ]", "[focus: ...]", "[focus: ok ]"];
const SHUTTER_FRAMES = ["[shutter: open ]", "[shutter: half ]", "[shutter: click]", "[shutter: open ]"];

function animationsEnabled(): boolean {
  return Boolean(process.stdout.isTTY && process.env.CI !== "true" && process.env.TERM !== "dumb" && process.env.GRAIN_NO_ANIM !== "1");
}

async function animateLine(label: string, frames: string[], delayMs = 70): Promise<void> {
  if (!animationsEnabled()) {
    return;
  }

  for (const frame of frames) {
    process.stdout.write(`\r${label} ${frame}`);
    await Bun.sleep(delayMs);
  }
  process.stdout.write(`\r${label} [done]        \n`);
}

function normalizeAscii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt(): Prompt {
  const stdin = process.stdin;
  const stdout = process.stdout;

  async function askText(message: string, options: { allowEmpty?: boolean; defaultValue?: string } = {}): Promise<string> {
    while (true) {
      const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
      stdout.write(`${message}${suffix}: `);
      const value = await new Promise<string>((resolve) => {
        stdin.resume();
        stdin.setEncoding("utf8");
        stdin.once("data", (chunk) => resolve(String(chunk).trim()));
      });

      const next = value || options.defaultValue || "";
      if (next || options.allowEmpty) {
        return next;
      }

      stdout.write("Value is required.\n");
    }
  }

  async function askYesNo(message: string, defaultYes = true): Promise<boolean> {
    while (true) {
      const suffix = defaultYes ? "[Y/n]" : "[y/N]";
      const value = (await askText(`${message} ${suffix}`, { allowEmpty: true })).toLowerCase();
      if (!value) {
        return defaultYes;
      }
      if (value === "y" || value === "yes") {
        return true;
      }
      if (value === "n" || value === "no") {
        return false;
      }
    }
  }

  return { askText, askYesNo };
}

export async function openInNativeViewer(bytes: Uint8Array, mimeType: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "grain-preview-"));
  const extension = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
      ? "webp"
      : mimeType.includes("gif")
        ? "gif"
        : mimeType.includes("avif")
          ? "avif"
          : mimeType.includes("heic") || mimeType.includes("heif")
            ? "heic"
            : "jpg";
  const filePath = join(dir, `preview.${extension}`);
  await writeFile(filePath, Buffer.from(bytes));

  try {
    if (process.platform === "darwin") {
      await Bun.spawn(["open", filePath], { stdout: "ignore", stderr: "ignore" }).exited;
      return;
    }
    if (process.platform === "linux") {
      await Bun.spawn(["xdg-open", filePath], { stdout: "ignore", stderr: "ignore" }).exited;
      return;
    }
  } catch {
    // ignore viewer errors
  }

  setTimeout(() => {
    void rm(dir, { recursive: true, force: true });
  }, 60_000);
}

export type UploadWizardResult = {
  title: string;
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
  exifMode: "include" | "exclude";
  mediaInputs: MediaInput[];
  altTexts: string[];
  altAi?: AltAiConfig;
};

export async function runUploadWizard(): Promise<UploadWizardResult> {
  const prompt = buildPrompt();

  console.log("grain - interactive gallery upload");
  await animateLine("Setting up your gallery", FOCUS_FRAMES);
  console.log("Tip: local paths must start with @, for example @photo.jpg or @./images/a.png");

  const title = await prompt.askText("Gallery title");
  const descriptionRaw = await prompt.askText("Description (supports @mentions #hashtags links)", { allowEmpty: true });
  const description = descriptionRaw || undefined;

  const addLocation = await prompt.askYesNo("Add location?");
  let locationName: string | undefined;
  let locationValue: string | undefined;
  let placeName: string | undefined;
  let street: string | undefined;
  let locality: string | undefined;
  let region: string | undefined;
  let postalCode: string | undefined;
  let country: string | undefined;

  if (addLocation) {
    locationName = await prompt.askText("Location name (display)");
    locationValue = await prompt.askText("Location value (H3 index)");
    placeName = (await prompt.askText("Address place name", { allowEmpty: true })) || undefined;
    street = (await prompt.askText("Address street", { allowEmpty: true })) || undefined;
    locality = (await prompt.askText("Address locality", { allowEmpty: true })) || undefined;
    region = (await prompt.askText("Address region", { allowEmpty: true })) || undefined;
    postalCode = (await prompt.askText("Address postal code", { allowEmpty: true })) || undefined;
    country = (await prompt.askText("Address country code", { allowEmpty: true })) || undefined;
  }

  const cw = (await prompt.askText("Content warnings (comma-separated labels, optional)", { allowEmpty: true })) || undefined;
  const includeExif = await prompt.askYesNo("Include EXIF metadata? (default yes)", true);
  const exifMode: "include" | "exclude" = includeExif ? "include" : "exclude";

  const useAltAi = await prompt.askYesNo("Use AI alt text generation?", false);
  let altAi: AltAiConfig | undefined;
  if (useAltAi) {
    const endpoint = await prompt.askText("Alt AI endpoint", { defaultValue: process.env.GRAIN_ALT_AI_ENDPOINT });
    const apiKey = await prompt.askText("Alt AI API key", { defaultValue: process.env.GRAIN_ALT_AI_API_KEY });
    const model = await prompt.askText("Alt AI model", { defaultValue: process.env.GRAIN_ALT_AI_MODEL });
    altAi = {
      endpoint: endpoint.replace(/\/$/, ""),
      apiKey,
      model,
    };
  }

  const mediaInputs: MediaInput[] = [];
  while (true) {
    const value = await prompt.askText("Add image (@path or https://url). Empty to continue", { allowEmpty: true });
    if (!value) {
      break;
    }
    try {
      mediaInputs.push(parseWizardMediaEntry(value));
      await animateLine(`Framed image ${mediaInputs.length}`, SHUTTER_FRAMES, 60);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
    }
  }

  if (mediaInputs.length === 0) {
    throw new GrainError("missing_media", "At least one image is required.");
  }

  return {
    title,
    description,
    locationName,
    locationValue,
    placeName,
    street,
    locality,
    region,
    postalCode,
    country,
    cw,
    exifMode,
    mediaInputs,
    altTexts: [],
    altAi,
  };
}

export async function promptForAltTextFallback(context: {
  index: number;
  total: number;
  sourceLabel: string;
  bytes: Uint8Array;
  mimeType: string;
  reason: "missing" | "ai_failed";
  errorMessage?: string;
}): Promise<string | undefined> {
  const prompt = buildPrompt();

  if (context.reason === "ai_failed") {
    console.log(`AI alt text failed for ${context.sourceLabel}: ${context.errorMessage ?? "unknown error"}`);
  }

  await animateLine("Opening preview", FOCUS_FRAMES, 60);
  await openInNativeViewer(context.bytes, context.mimeType);
  const value = await prompt.askText(`Alt text for image ${context.index + 1}/${context.total} (${context.sourceLabel})`, {
    allowEmpty: true,
  });
  return normalizeAscii(value) || undefined;
}

export function normalizePromptAltText(value: string): string {
  return normalizeAscii(value);
}
