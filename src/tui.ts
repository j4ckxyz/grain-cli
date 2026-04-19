import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrainError } from "./errors";
import { parseWizardMediaEntry } from "./media-input";
import type { AltAiConfig, MediaInput, PostingStyle } from "./types";

type Prompt = {
  askText(message: string, options?: { allowEmpty?: boolean; defaultValue?: string }): Promise<string>;
  askYesNo(message: string, defaultYes?: boolean): Promise<boolean>;
  askChoice(message: string, choices: string[], defaultIndex?: number): Promise<number>;
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

  async function askChoice(message: string, choices: string[], defaultIndex = 0): Promise<number> {
    while (true) {
      stdout.write(`${message}\n`);
      for (let i = 0; i < choices.length; i += 1) {
        stdout.write(`  ${i + 1}) ${choices[i]}\n`);
      }
      const raw = await askText("Choose a number", { allowEmpty: true, defaultValue: String(defaultIndex + 1) });
      const index = Number.parseInt(raw, 10) - 1;
      if (Number.isFinite(index) && index >= 0 && index < choices.length) {
        return index;
      }
      stdout.write("Please choose one of the listed numbers.\n");
    }
  }

  return { askText, askYesNo, askChoice };
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
  scheduleAt?: string;
};

type StartFlowResult =
  | {
      action: "post";
      upload: UploadWizardResult;
      saveAsStyleName?: string;
      queueIfOffline: boolean;
    }
  | {
      action: "save_draft";
      upload: UploadWizardResult;
    };

export async function runUploadWizard(initial: Partial<UploadWizardResult> = {}): Promise<UploadWizardResult> {
  const prompt = buildPrompt();

  console.log("grain - interactive gallery upload");
  await animateLine("Setting up your gallery", FOCUS_FRAMES);
  console.log("Tip: local paths must start with @, for example @photo.jpg or @./images/a.png");

  const title = await prompt.askText("Gallery title", { defaultValue: initial.title });
  const descriptionRaw = await prompt.askText("Description (supports @mentions #hashtags links)", {
    allowEmpty: true,
    defaultValue: initial.description,
  });
  const description = descriptionRaw || undefined;

  const hasInitialLocation = Boolean(
    initial.locationName ||
      initial.locationValue ||
      initial.placeName ||
      initial.street ||
      initial.locality ||
      initial.region ||
      initial.postalCode ||
      initial.country,
  );

  const addLocation = await prompt.askYesNo("Add location?", hasInitialLocation);
  let locationName: string | undefined;
  let locationValue: string | undefined;
  let placeName: string | undefined;
  let street: string | undefined;
  let locality: string | undefined;
  let region: string | undefined;
  let postalCode: string | undefined;
  let country: string | undefined;

  if (addLocation) {
    locationName = await prompt.askText("Location name (display)", { defaultValue: initial.locationName });
    locationValue = await prompt.askText("Location value (H3 index)", { defaultValue: initial.locationValue });
    placeName =
      (await prompt.askText("Address place name", { allowEmpty: true, defaultValue: initial.placeName })) || undefined;
    street = (await prompt.askText("Address street", { allowEmpty: true, defaultValue: initial.street })) || undefined;
    locality = (await prompt.askText("Address locality", { allowEmpty: true, defaultValue: initial.locality })) || undefined;
    region = (await prompt.askText("Address region", { allowEmpty: true, defaultValue: initial.region })) || undefined;
    postalCode =
      (await prompt.askText("Address postal code", { allowEmpty: true, defaultValue: initial.postalCode })) || undefined;
    country = (await prompt.askText("Address country code", { allowEmpty: true, defaultValue: initial.country })) || undefined;
  }

  const cw =
    (await prompt.askText("Content warnings (comma-separated labels, optional)", {
      allowEmpty: true,
      defaultValue: initial.cw,
    })) || undefined;
  const includeExif = await prompt.askYesNo("Include EXIF metadata? (default yes)", (initial.exifMode ?? "include") === "include");
  const exifMode: "include" | "exclude" = includeExif ? "include" : "exclude";

  const useAltAi = await prompt.askYesNo("Use AI alt text generation?", Boolean(initial.altAi));
  let altAi: AltAiConfig | undefined;
  if (useAltAi) {
    const endpoint = await prompt.askText("Alt AI endpoint", {
      defaultValue: initial.altAi?.endpoint ?? process.env.GRAIN_ALT_AI_ENDPOINT,
    });
    const apiKey = await prompt.askText("Alt AI API key", {
      defaultValue: initial.altAi?.apiKey ?? process.env.GRAIN_ALT_AI_API_KEY,
    });
    const model = await prompt.askText("Alt AI model", {
      defaultValue: initial.altAi?.model ?? process.env.GRAIN_ALT_AI_MODEL,
    });
    altAi = {
      endpoint: endpoint.replace(/\/$/, ""),
      apiKey,
      model,
    };
  }

  const mediaInputs: MediaInput[] = [];
  if ((initial.mediaInputs?.length ?? 0) > 0) {
    const keepCurrent = await prompt.askYesNo(`Keep current ${initial.mediaInputs!.length} image(s)?`, true);
    if (keepCurrent) {
      mediaInputs.push(...initial.mediaInputs!);
    }
  }

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
    altTexts: initial.altTexts ?? [],
    altAi,
    scheduleAt: initial.scheduleAt,
  };
}

function parseScheduleInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new GrainError("invalid_schedule", "Could not parse schedule time.", "Use an ISO date/time like 2026-05-01T09:30:00.");
  }
  return date.toISOString();
}

function styleToWizardBase(style: PostingStyle): Partial<UploadWizardResult> {
  return {
    description: style.description,
    locationName: style.locationName,
    locationValue: style.locationValue,
    placeName: style.placeName,
    street: style.street,
    locality: style.locality,
    region: style.region,
    postalCode: style.postalCode,
    country: style.country,
    cw: style.cw,
    exifMode: style.exifMode ?? "include",
  };
}

export async function runStartFlow(input: {
  styles: PostingStyle[];
  draftCount: number;
}): Promise<StartFlowResult> {
  const prompt = buildPrompt();
  console.log("grain start - guided posting");
  await animateLine("Loading camera bag", FOCUS_FRAMES, 65);

  const modeChoices = ["Create and publish now (recommended)", "Save an unfinished draft"];
  if (input.draftCount > 0) {
    modeChoices.push(`Resume saved draft (use grain drafts, ${input.draftCount} available)`);
  }

  const mode = await prompt.askChoice("What do you want to do?", modeChoices, 0);
  if (mode === 1) {
    const upload = await runUploadWizard();
    return { action: "save_draft", upload };
  }

  if (mode === 2) {
    throw new GrainError("resume_draft_from_start", "Use `grain drafts` to pick and resume a saved draft.");
  }

  let chosenStyle: PostingStyle | undefined;
  if (input.styles.length > 0) {
    const useStyle = await prompt.askYesNo("Use a saved posting style?", true);
    if (useStyle) {
      const index = await prompt.askChoice(
        "Pick a style",
        input.styles.map((style) => style.name),
        0,
      );
      chosenStyle = input.styles[index];
    }
  }

  const upload = await runUploadWizard(chosenStyle ? styleToWizardBase(chosenStyle) : {});

  const scheduleInput = await prompt.askText("Schedule time (optional, ISO format)", {
    allowEmpty: true,
    defaultValue: upload.scheduleAt,
  });
  upload.scheduleAt = parseScheduleInput(scheduleInput);

  const queueIfOffline = await prompt.askYesNo("Queue and retry automatically if publish fails?", true);
  const saveAsStyle = await prompt.askYesNo("Save this setup as a reusable style?", false);
  const saveAsStyleName = saveAsStyle ? await prompt.askText("Style name") : undefined;

  return {
    action: "post",
    upload,
    saveAsStyleName,
    queueIfOffline,
  };
}

export async function reviewUploadPlan(upload: UploadWizardResult): Promise<"publish" | "edit" | "save_draft"> {
  const prompt = buildPrompt();
  console.log("\nReview before publish");
  console.log(`- Title: ${upload.title}`);
  console.log(`- Description: ${upload.description ?? "(none)"}`);
  console.log(`- Images: ${upload.mediaInputs.length}`);
  console.log(`- EXIF: ${upload.exifMode}`);
  if (upload.scheduleAt) {
    console.log(`- Schedule: ${upload.scheduleAt}`);
  }

  const choice = await prompt.askChoice("Choose next step", ["Publish", "Edit details", "Save draft for later"], 0);
  if (choice === 1) {
    return "edit";
  }
  if (choice === 2) {
    return "save_draft";
  }
  return "publish";
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
