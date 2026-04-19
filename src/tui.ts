import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrainError } from "./errors";
import { parseWizardMediaEntry } from "./media-input";
import type { AltAiConfig, MediaInput, PostingStyle, StartDefaults } from "./types";

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

function normalizeReasoningEffort(value: string | undefined): AltAiConfig["reasoningEffort"] {
  const next = (value ?? "none").trim().toLowerCase();
  if (!next) {
    return "none";
  }
  if (next === "none" || next === "minimal" || next === "low" || next === "medium" || next === "high" || next === "xhigh") {
    return next;
  }
  throw new GrainError("invalid_reasoning_effort", "Reasoning level must be one of: none|minimal|low|medium|high|xhigh.");
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
        stdin.once("data", (chunk) => {
          stdin.pause();
          resolve(String(chunk).trim());
        });
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

  const cleanupTimer = setTimeout(() => {
    void rm(dir, { recursive: true, force: true });
  }, 60_000);
  if (typeof cleanupTimer === "object" && cleanupTimer !== null && "unref" in cleanupTimer) {
    const maybeTimer = cleanupTimer as { unref?: () => void };
    maybeTimer.unref?.();
  }
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
      startDefaults: StartDefaults;
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
    const reasoningEffortRaw = await prompt.askText("Reasoning level (none|minimal|low|medium|high|xhigh)", {
      allowEmpty: true,
      defaultValue: initial.altAi?.reasoningEffort ?? process.env.GRAIN_ALT_AI_REASONING ?? "none",
    });
    const showReasoning = await prompt.askYesNo("Show model reasoning in terminal if available?", initial.altAi?.showReasoning ?? false);

    altAi = {
      endpoint: endpoint.replace(/\/$/, ""),
      apiKey,
      model,
      reasoningEffort: normalizeReasoningEffort(reasoningEffortRaw || "none"),
      showReasoning,
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

function hasLocationFields(upload: Partial<UploadWizardResult>): boolean {
  return Boolean(
    upload.locationName ||
      upload.locationValue ||
      upload.placeName ||
      upload.street ||
      upload.locality ||
      upload.region ||
      upload.postalCode ||
      upload.country,
  );
}

function mediaLabel(media: MediaInput, index: number): string {
  const short = media.value.length > 60 ? `${media.value.slice(0, 57)}...` : media.value;
  return `${index + 1}) ${media.kind === "path" ? "@" : ""}${short}`;
}

function normalizeManualAlt(value: string): string {
  return normalizeAscii(value);
}

function reorderByIndex<T>(items: T[], order: number[]): T[] {
  return order.map((index) => items[index]);
}

function parseReorderInput(raw: string, size: number): number[] {
  const parts = raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10) - 1)
    .filter((value) => Number.isFinite(value));

  if (parts.length !== size) {
    throw new GrainError("invalid_reorder", `Please provide exactly ${size} numbers.`);
  }

  const seen = new Set<number>();
  for (const index of parts) {
    if (index < 0 || index >= size || seen.has(index)) {
      throw new GrainError("invalid_reorder", "Photo order must include each photo exactly once.");
    }
    seen.add(index);
  }

  return parts;
}

export async function runStartFlow(input: {
  styles: PostingStyle[];
  draftCount: number;
  defaultAltAi?: AltAiConfig;
  startDefaults?: Partial<StartDefaults>;
}): Promise<StartFlowResult> {
  const prompt = buildPrompt();
  console.log("grain start - guided posting");
  await animateLine("Loading camera bag", FOCUS_FRAMES, 65);

  if (input.draftCount > 0) {
    console.log(`Tip: you have ${input.draftCount} saved draft(s). Resume anytime with: grain drafts`);
  }

  const title = await prompt.askText("Gallery title");
  const descriptionRaw = await prompt.askText("Description (optional)", {
    allowEmpty: true,
  });
  let description = descriptionRaw || undefined;

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

  const altTexts: string[] = [];
  let altAi: AltAiConfig | undefined;

  if (input.defaultAltAi) {
    const useAltAi = await prompt.askYesNo("Use saved AI alt text settings?", true);
    if (useAltAi) {
      altAi = input.defaultAltAi;
    }
  }

  if (!altAi) {
    const addManualAlt = await prompt.askYesNo("Add manual alt text now?", true);
    if (addManualAlt) {
      for (let i = 0; i < mediaInputs.length; i += 1) {
        const alt = await prompt.askText(`Alt text for image ${i + 1}/${mediaInputs.length} (${mediaInputs[i].value})`, {
          allowEmpty: true,
        });
        altTexts.push(normalizeManualAlt(alt));
      }
    }
  }

  const defaults: StartDefaults = {
    exifMode: input.startDefaults?.exifMode === "exclude" ? "exclude" : "include",
    queueIfOffline: input.startDefaults?.queueIfOffline ?? true,
  };

  let queueIfOffline = defaults.queueIfOffline;
  let exifMode: "include" | "exclude" = defaults.exifMode;
  let scheduleAt: string | undefined;
  let cw: string | undefined;
  let locationName: string | undefined;
  let locationValue: string | undefined;
  let placeName: string | undefined;
  let street: string | undefined;
  let locality: string | undefined;
  let region: string | undefined;
  let postalCode: string | undefined;
  let country: string | undefined;
  let saveAsStyleName: string | undefined;

  const useAdvanced = await prompt.askYesNo("Open advanced options? (schedule, retry, EXIF, location, reorder)", false);
  if (useAdvanced) {
    let styleBase: Partial<UploadWizardResult> = {};
    if (input.styles.length > 0) {
      const useStyle = await prompt.askYesNo("Apply a saved style for optional defaults?", false);
      if (useStyle) {
        const index = await prompt.askChoice(
          "Pick a style",
          input.styles.map((style) => style.name),
          0,
        );
        styleBase = styleToWizardBase(input.styles[index]);
        if (!description && styleBase.description) {
          description = styleBase.description;
        }
      }
    }

    const scheduleInput = await prompt.askText("Schedule time (optional, ISO format)", {
      allowEmpty: true,
    });
    scheduleAt = parseScheduleInput(scheduleInput);

    queueIfOffline = await prompt.askYesNo("Queue and retry automatically if publish fails?", queueIfOffline);
    const includeExif = await prompt.askYesNo("Include EXIF metadata?", (styleBase.exifMode ?? exifMode) === "include");
    exifMode = includeExif ? "include" : "exclude";

    const addLocation = await prompt.askYesNo("Add location details?", hasLocationFields(styleBase));
    if (addLocation) {
      locationName = await prompt.askText("Location name (display)", { defaultValue: styleBase.locationName });
      locationValue = await prompt.askText("Location value (H3 index)", { defaultValue: styleBase.locationValue });
      placeName =
        (await prompt.askText("Address place name", { allowEmpty: true, defaultValue: styleBase.placeName })) || undefined;
      street = (await prompt.askText("Address street", { allowEmpty: true, defaultValue: styleBase.street })) || undefined;
      locality = (await prompt.askText("Address locality", { allowEmpty: true, defaultValue: styleBase.locality })) || undefined;
      region = (await prompt.askText("Address region", { allowEmpty: true, defaultValue: styleBase.region })) || undefined;
      postalCode =
        (await prompt.askText("Address postal code", { allowEmpty: true, defaultValue: styleBase.postalCode })) || undefined;
      country = (await prompt.askText("Address country code", { allowEmpty: true, defaultValue: styleBase.country })) || undefined;
    }

    const addContentWarnings = await prompt.askYesNo("Add content warnings?", Boolean(styleBase.cw));
    if (addContentWarnings) {
      cw =
        (await prompt.askText("Content warnings (comma-separated labels)", {
          allowEmpty: true,
          defaultValue: styleBase.cw,
        })) || undefined;
    }

    const reorder = await prompt.askYesNo("Reorder photos before publish?", false);
    if (reorder && mediaInputs.length > 1) {
      while (true) {
        console.log("Current photo order:");
        for (let i = 0; i < mediaInputs.length; i += 1) {
          console.log(`  ${mediaLabel(mediaInputs[i], i)}`);
        }
        const rawOrder = await prompt.askText(`New order as comma numbers (example: 2,1${mediaInputs.length > 2 ? ",3" : ""})`);
        try {
          const order = parseReorderInput(rawOrder, mediaInputs.length);
          const nextMedia = reorderByIndex(mediaInputs, order);
          mediaInputs.splice(0, mediaInputs.length, ...nextMedia);
          if (altTexts.length > 0) {
            const nextAlts = reorderByIndex(altTexts, order);
            altTexts.splice(0, altTexts.length, ...nextAlts);
          }
          break;
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
        }
      }
    }

    const saveAsStyle = await prompt.askYesNo("Save these optional settings as a reusable style?", false);
    saveAsStyleName = saveAsStyle ? await prompt.askText("Style name") : undefined;
  }

  const upload: UploadWizardResult = {
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
    altTexts,
    altAi,
    scheduleAt,
  };

  return {
    action: "post",
    upload,
    saveAsStyleName,
    queueIfOffline,
    startDefaults: {
      exifMode,
      queueIfOffline,
    },
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
