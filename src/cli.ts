import { getOption, getOptionList, hasOption, parseArgs } from "./args";
import { loadConfig, saveConfig } from "./config";
import { deleteDraft, getDraft, listDrafts, saveDraft, type UploadDraft } from "./drafts";
import { GrainError, toGrainError } from "./errors";
import { parseContentWarnings, uploadGallery, validateUploadOptions } from "./gallery";
import { buildGrainGalleryUrl, buildGrainLibraryUrl } from "./links";
import { normalizeLocalPathToken, parsePositionalMediaToken } from "./media-input";
import { getAuthorizedAgent, getSessionInfo, loginWithOAuth, logoutOAuth } from "./oauth";
import { clearQueue, enqueueUpload, listQueuedUploads, removeQueuedUpload, updateQueuedUpload } from "./queue";
import { editAltTextsInReview, promptForAltTextFallback, reviewUploadPlan, runStartFlow, runUploadWizard } from "./tui";
import type { AltAiConfig, MediaInput, PostingStyle } from "./types";
import { runSelfUpdate } from "./update";

const LENS_FRAMES = ["[lens: .  ]", "[lens: .. ]", "[lens: ...]", "[lens: clear]"];

function terminalAnimationEnabled(): boolean {
  return Boolean(process.stdout.isTTY && process.env.CI !== "true" && process.env.TERM !== "dumb" && process.env.GRAIN_NO_ANIM !== "1");
}

async function animateStatus(label: string, frames: string[], delayMs = 70): Promise<void> {
  if (!terminalAnimationEnabled()) {
    return;
  }

  for (const frame of frames) {
    process.stdout.write(`\r${label} ${frame}`);
    await Bun.sleep(delayMs);
  }
  process.stdout.write(`\r${label} [ready]      \n`);
}

function printHelp(): void {
  console.log(`grain

Simple uploader for Grain.social.

Commands:
  grain start
  grain help
  grain login [--handle <handle>]
  grain whoami
  grain whoami --debug
  grain update
  grain logout
  grain auth login
  grain auth status
  grain auth logout
  grain drafts [list|resume|delete] [--id <draft-id>]
  grain queue [list|run|clear]
  grain styles [list|save|delete] [--name <style-name>]
  grain upload-gallery --title <title> [--description <text>] [--location-name <name>] [--location-value <h3>] [--country <code>] [--locality <name>] [--region <name>] [--street <value>] [--postal-code <code>] [--place-name <name>] [--cw <label1,label2>] [--alt <text> ...] [--image <path> ...] [--image-url <url> ...] [--exif include|exclude] [--schedule-at <iso-date>] [--queue-on-fail] [--alt-ai-endpoint <url> --alt-ai-api-key <key> --alt-ai-model <model>] <image-path-or-url ...>

Run without a command to start guided posting.
`);
}

function normalizeReasoningEffort(value: string | undefined): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const next = (value ?? "none").trim().toLowerCase();
  if (!next) {
    return "none";
  }
  if (next === "none" || next === "minimal" || next === "low" || next === "medium" || next === "high" || next === "xhigh") {
    return next;
  }
  throw new GrainError("invalid_reasoning_effort", "Reasoning effort must be one of: none|minimal|low|medium|high|xhigh.");
}

function requireOption(options: Map<string, string[]>, name: string): string {
  const value = getOption(options, name);
  if (!value) {
    throw new GrainError("missing_option", `Missing required option: --${name}`);
  }
  return value;
}

function normalizeExifMode(value: string | undefined): "include" | "exclude" {
  const normalized = (value ?? "include").trim().toLowerCase();
  if (normalized !== "include" && normalized !== "exclude") {
    throw new GrainError("invalid_exif_mode", "--exif must be either 'include' or 'exclude'.");
  }
  return normalized;
}

function normalizeManualAltList(values: string[]): string[] {
  return values.map((value) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function promptLine(message: string, allowEmpty = false): Promise<string> {
  while (true) {
    process.stdout.write(`${message}: `);
    const value = await new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (chunk) => {
        process.stdin.pause();
        resolve(String(chunk).trim());
      });
    });

    if (value || allowEmpty) {
      return value;
    }
  }
}

function parseAltAi(parsed: ReturnType<typeof parseArgs>): AltAiConfig | undefined {
  const endpoint = getOption(parsed.options, "alt-ai-endpoint") ?? process.env.GRAIN_ALT_AI_ENDPOINT;
  const apiKey = getOption(parsed.options, "alt-ai-api-key") ?? process.env.GRAIN_ALT_AI_API_KEY;
  const model = getOption(parsed.options, "alt-ai-model") ?? process.env.GRAIN_ALT_AI_MODEL;
  const reasoningEffort = normalizeReasoningEffort(getOption(parsed.options, "alt-ai-reasoning") ?? process.env.GRAIN_ALT_AI_REASONING);
  const showReasoning = hasOption(parsed.options, "alt-ai-show-reasoning") || process.env.GRAIN_ALT_AI_SHOW_REASONING === "1";

  const hasAny = [endpoint, apiKey, model].some((value) => Boolean(value));
  if (!hasAny) {
    return undefined;
  }

  if (!endpoint || !apiKey || !model) {
    throw new GrainError(
      "invalid_alt_ai_config",
      "Alt-text AI requires --alt-ai-endpoint, --alt-ai-api-key, and --alt-ai-model (or GRAIN_ALT_AI_* env vars).",
    );
  }

  return {
    endpoint: endpoint.replace(/\/$/, ""),
    apiKey,
    model,
    reasoningEffort,
    showReasoning,
  };
}

async function cmdAuth(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sub = parsed.positional[0] ?? "status";

  if (sub === "status") {
    const config = await loadConfig();
    if (!config?.altAi) {
      console.log("Alt-text AI is not configured.");
      return;
    }
    console.log("Alt-text AI is configured:");
    console.log(`- Endpoint: ${config.altAi.endpoint}`);
    console.log(`- Model: ${config.altAi.model}`);
    console.log(`- Reasoning: ${config.altAi.reasoningEffort}`);
    console.log(`- Show reasoning: ${config.altAi.showReasoning ? "yes" : "no"}`);
    return;
  }

  if (sub === "logout") {
    const config = (await loadConfig()) ?? {};
    if (!config.altAi) {
      console.log("Alt-text AI is already not configured.");
      return;
    }
    await saveConfig({
      ...config,
      altAi: undefined,
    });
    console.log("Cleared saved Alt-text AI settings.");
    return;
  }

  if (sub === "login") {
    const endpoint = (getOption(parsed.options, "endpoint") ?? (await promptLine("OpenAI-compatible endpoint (e.g. https://openrouter.ai/api/v1)"))).trim();
    const apiKey = (getOption(parsed.options, "api-key") ?? (await promptLine("API key"))).trim();
    const model = (getOption(parsed.options, "model") ?? (await promptLine("Vision-capable model ID (required)")).trim());
    const reasoningInput =
      getOption(parsed.options, "reasoning") ??
      (await promptLine("Reasoning level (none|minimal|low|medium|high|xhigh)", true));
    const reasoningEffort = normalizeReasoningEffort(
      reasoningInput || "none",
    );
    const showReasoningInput =
      getOption(parsed.options, "show-reasoning") ?? (await promptLine("Show reasoning in terminal? (yes/no)", true));
    const showReasoningRaw = showReasoningInput || "no";
    const showReasoning = ["1", "y", "yes", "true"].includes(showReasoningRaw.trim().toLowerCase());

    if (!endpoint || !apiKey || !model) {
      throw new GrainError("invalid_auth_input", "Endpoint, API key, and model are required.");
    }

    const config = (await loadConfig()) ?? {};
    await saveConfig({
      ...config,
      altAi: {
        endpoint: endpoint.replace(/\/$/, ""),
        apiKey,
        model,
        reasoningEffort,
        showReasoning,
      },
    });

    console.log("Saved Alt-text AI settings.");
    console.log("Tip: use a vision-capable model (must support image input). Example via OpenRouter: google/gemini-3-flash-preview.");
    if (reasoningEffort === "none") {
      console.log("Reasoning: disabled.");
    } else {
      console.log(`Reasoning: enabled at '${reasoningEffort}' (${showReasoning ? "shown in terminal when returned" : "hidden in terminal"}).`);
    }
    return;
  }

  throw new GrainError("unknown_auth_command", `Unknown auth subcommand: ${sub}`);
}

function parseMediaInputs(parsed: ReturnType<typeof parseArgs>): MediaInput[] {
  const imageArgs = getOptionList(parsed.options, "image").map((value) => ({
    kind: "path",
    value: normalizeLocalPathToken(value),
  }) satisfies MediaInput);
  const imageUrlArgs = getOptionList(parsed.options, "image-url").map((value) => ({ kind: "url", value }) satisfies MediaInput);
  const positionalMedia = parsed.positional.map(parsePositionalMediaToken);
  return [...imageArgs, ...imageUrlArgs, ...positionalMedia];
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timed out") ||
    message.includes("connection") ||
    message.includes("econn")
  );
}

function styleFromUpload(name: string, upload: {
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
}): PostingStyle {
  return {
    name,
    description: upload.description,
    locationName: upload.locationName,
    locationValue: upload.locationValue,
    placeName: upload.placeName,
    street: upload.street,
    locality: upload.locality,
    region: upload.region,
    postalCode: upload.postalCode,
    country: upload.country,
    cw: upload.cw,
    exifMode: upload.exifMode,
  };
}

async function upsertStyle(style: PostingStyle): Promise<void> {
  const config = (await loadConfig()) ?? {};
  const styles = config.styles ?? [];
  await saveConfig({
    ...config,
    styles: [...styles.filter((entry) => entry.name !== style.name), style],
  });
}

type PublishPayload = {
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
  queueIfOffline?: boolean;
  onAltTextNeeded?: typeof promptForAltTextFallback;
};

function queuePayloadFromPublish(payload: PublishPayload) {
  return {
    title: payload.title,
    description: payload.description,
    locationName: payload.locationName,
    locationValue: payload.locationValue,
    placeName: payload.placeName,
    street: payload.street,
    locality: payload.locality,
    region: payload.region,
    postalCode: payload.postalCode,
    country: payload.country,
    cw: payload.cw,
    exifMode: payload.exifMode,
    mediaInputs: payload.mediaInputs,
    altTexts: payload.altTexts,
    altAi: payload.altAi,
  };
}

async function publishUpload(payload: PublishPayload): Promise<void> {
  if (payload.scheduleAt) {
    const when = new Date(payload.scheduleAt);
    if (Number.isNaN(when.getTime())) {
      throw new GrainError("invalid_schedule", `Invalid schedule timestamp: ${payload.scheduleAt}`);
    }
    if (when.getTime() > Date.now()) {
      const queued = await enqueueUpload({
        ...queuePayloadFromPublish(payload),
        notBefore: payload.scheduleAt,
      });
      console.log(`Scheduled for later as queue item ${queued.id} (${payload.scheduleAt}).`);
      return;
    }
  }

  const { agent, did } = await getAuthorizedAgent(false);
  const contentWarnings = parseContentWarnings(payload.cw);
  const address = {
    name: payload.placeName,
    street: payload.street,
    locality: payload.locality,
    region: payload.region,
    postalCode: payload.postalCode,
    country: payload.country,
  };

  validateUploadOptions({
    agent,
    did,
    title: payload.title,
    description: payload.description,
    locationName: payload.locationName,
    locationValue: payload.locationValue,
    address,
    contentWarnings,
    mediaInputs: payload.mediaInputs,
    altTexts: payload.altTexts,
    altAi: payload.altAi,
    exifMode: payload.exifMode,
  });

  console.log(`Uploading ${payload.mediaInputs.length} image(s) to Grain.social...`);
  try {
    const result = await uploadGallery({
      agent,
      did,
      title: payload.title,
      description: payload.description,
      locationName: payload.locationName,
      locationValue: payload.locationValue,
      address,
      contentWarnings,
      mediaInputs: payload.mediaInputs,
      altTexts: payload.altTexts,
      altAi: payload.altAi,
      exifMode: payload.exifMode,
      onAltTextNeeded: payload.onAltTextNeeded,
    });

    const galleryUrl = buildGrainGalleryUrl(result.galleryUri);
    console.log(`Created gallery: ${result.galleryUri}`);
    if (galleryUrl) {
      console.log(`Gallery URL: ${galleryUrl}`);
    }
    for (const uri of result.photoUris) {
      console.log(`Photo: ${uri}`);
    }
    console.log(`Grain library: ${buildGrainLibraryUrl(did)}`);
  } catch (error) {
    if (payload.queueIfOffline && isNetworkFailure(error)) {
      const queued = await enqueueUpload(queuePayloadFromPublish(payload));
      console.log(`Upload failed due to network issue. Saved to retry queue as ${queued.id}.`);
      return;
    }
    throw error;
  }
}

async function cmdLogin(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (hasOption(parsed.options, "pds") || hasOption(parsed.options, "app-password")) {
    throw new GrainError(
      "legacy_login_flags",
      "`grain login` now uses browser sign-in and no longer accepts --pds or --app-password.",
      "Run `grain login --handle your.handle` and approve in browser.",
    );
  }

  let handle = getOption(parsed.options, "handle");
  if (!handle) {
    handle = await promptLine("Handle (for example j4ck.xyz)");
  }

  if (!handle) {
    throw new GrainError("missing_handle", "Handle is required for login.");
  }

  await animateStatus("Starting secure browser login", LENS_FRAMES, 65);
  const result = await loginWithOAuth(handle);
  console.log(`Logged in as ${result.handle}`);
  console.log(`Grain library: ${result.libraryUrl}`);
}

async function cmdWhoAmI(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const debug = hasOption(parsed.options, "debug");
  const { did, handle } = await getAuthorizedAgent(false);
  console.log(`Handle: ${handle}`);
  console.log(`Grain library: ${buildGrainLibraryUrl(did)}`);

  if (debug) {
    const session = await getSessionInfo();
    if (session?.expiresAt) {
      console.log(`Session refresh expiry: ${session.expiresAt}`);
    } else {
      console.log("Session refresh expiry: unknown");
    }
  }
}

async function cmdLogout(): Promise<void> {
  await logoutOAuth();
  console.log("Logged out and removed saved session.");
}

async function cmdUpdate(): Promise<void> {
  await runSelfUpdate();
}

async function cmdUploadGallery(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const title = requireOption(parsed.options, "title");
  const description = getOption(parsed.options, "description");
  const locationName = getOption(parsed.options, "location-name");
  const locationValue = getOption(parsed.options, "location-value");
  const mediaInputs = parseMediaInputs(parsed);
  const altTexts = normalizeManualAltList(getOptionList(parsed.options, "alt"));
  const config = await loadConfig();
  const altAiFromFlags = parseAltAi(parsed);
  const altAi =
    altAiFromFlags ??
    (config?.altAi
      ? {
          endpoint: config.altAi.endpoint,
          apiKey: config.altAi.apiKey,
          model: config.altAi.model,
          reasoningEffort: config.altAi.reasoningEffort,
          showReasoning: config.altAi.showReasoning,
        }
      : undefined);
  const exifMode = normalizeExifMode(getOption(parsed.options, "exif"));
  const scheduleAt = getOption(parsed.options, "schedule-at");
  const cw = getOption(parsed.options, "cw");

  await publishUpload({
    title,
    description,
    locationName,
    locationValue,
    placeName: getOption(parsed.options, "place-name"),
    street: getOption(parsed.options, "street"),
    locality: getOption(parsed.options, "locality"),
    region: getOption(parsed.options, "region"),
    postalCode: getOption(parsed.options, "postal-code"),
    country: getOption(parsed.options, "country"),
    cw,
    exifMode,
    mediaInputs,
    altTexts,
    altAi,
    scheduleAt,
    queueIfOffline: hasOption(parsed.options, "queue-on-fail"),
  });
}

function draftInputFromUpload(upload: {
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
}) {
  return {
    ...upload,
  };
}

async function runGuidedPost(initial?: UploadDraft): Promise<void> {
  let wizard = initial
    ? await runUploadWizard({
        title: initial.title,
        description: initial.description,
        locationName: initial.locationName,
        locationValue: initial.locationValue,
        placeName: initial.placeName,
        street: initial.street,
        locality: initial.locality,
        region: initial.region,
        postalCode: initial.postalCode,
        country: initial.country,
        cw: initial.cw,
        exifMode: initial.exifMode,
        mediaInputs: initial.mediaInputs,
        altTexts: initial.altTexts,
        altAi: initial.altAi,
        scheduleAt: initial.scheduleAt,
      })
    : await runUploadWizard();

  while (true) {
    const review = await reviewUploadPlan(wizard);
    if (review === "edit") {
      wizard = await runUploadWizard(wizard);
      continue;
    }
    if (review === "edit_alt") {
      wizard = {
        ...wizard,
        altTexts: await editAltTextsInReview(wizard),
      };
      continue;
    }

    if (review === "save_draft") {
      const saved = await saveDraft(draftInputFromUpload(wizard));
      if (initial) {
        await deleteDraft(initial.id);
      }
      console.log(`Saved draft ${saved.id}. Resume later with: grain drafts resume --id ${saved.id}`);
      return;
    }

    await publishUpload({
      ...wizard,
      queueIfOffline: true,
      onAltTextNeeded: promptForAltTextFallback,
    });
    if (initial) {
      await deleteDraft(initial.id);
    }
    return;
  }
}

async function cmdStart(): Promise<void> {
  const config = await loadConfig();
  const safeConfig = config ?? {};
  const defaultAltAi = config?.altAi
    ? {
        endpoint: config.altAi.endpoint,
        apiKey: config.altAi.apiKey,
        model: config.altAi.model,
        reasoningEffort: config.altAi.reasoningEffort,
        showReasoning: config.altAi.showReasoning,
      }
    : undefined;
  const drafts = await listDrafts();
  const startFlow = await runStartFlow({
    styles: config?.styles ?? [],
    draftCount: drafts.length,
    defaultAltAi,
    startDefaults: config?.startDefaults,
  });

  if (startFlow.action === "save_draft") {
    const saved = await saveDraft(draftInputFromUpload(startFlow.upload));
    console.log(`Saved draft ${saved.id}.`);
    return;
  }

  if (startFlow.saveAsStyleName) {
    await upsertStyle(
      styleFromUpload(startFlow.saveAsStyleName, {
        description: startFlow.upload.description,
        locationName: startFlow.upload.locationName,
        locationValue: startFlow.upload.locationValue,
        placeName: startFlow.upload.placeName,
        street: startFlow.upload.street,
        locality: startFlow.upload.locality,
        region: startFlow.upload.region,
        postalCode: startFlow.upload.postalCode,
        country: startFlow.upload.country,
        cw: startFlow.upload.cw,
        exifMode: startFlow.upload.exifMode,
      }),
    );
    console.log(`Saved style: ${startFlow.saveAsStyleName}`);
  }

  await saveConfig({
    ...safeConfig,
    startDefaults: startFlow.startDefaults,
  });

  let upload = startFlow.upload;
  while (true) {
    const review = await reviewUploadPlan(upload);
    if (review === "edit") {
      upload = await runUploadWizard(upload);
      continue;
    }
    if (review === "edit_alt") {
      upload = {
        ...upload,
        altTexts: await editAltTextsInReview(upload),
      };
      continue;
    }
    if (review === "save_draft") {
      const saved = await saveDraft(draftInputFromUpload(upload));
      console.log(`Saved draft ${saved.id}.`);
      return;
    }

    await publishUpload({
      ...upload,
      queueIfOffline: startFlow.queueIfOffline,
      onAltTextNeeded: promptForAltTextFallback,
    });
    return;
  }
}

async function cmdDrafts(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sub = parsed.positional[0] ?? "list";

  if (sub === "list") {
    const drafts = await listDrafts();
    if (drafts.length === 0) {
      console.log("No drafts saved.");
      return;
    }
    for (const draft of drafts) {
      console.log(`${draft.id}  ${draft.title}  (${draft.mediaInputs.length} image(s))`);
    }
    return;
  }

  const id = getOption(parsed.options, "id");
  if (!id) {
    throw new GrainError("missing_draft_id", "Provide --id for this drafts action.");
  }

  if (sub === "delete") {
    await deleteDraft(id);
    console.log(`Deleted draft ${id}.`);
    return;
  }

  if (sub === "resume") {
    const draft = await getDraft(id);
    if (!draft) {
      throw new GrainError("draft_not_found", `Draft not found: ${id}`);
    }
    await runGuidedPost(draft);
    return;
  }

  throw new GrainError("unknown_drafts_command", `Unknown drafts subcommand: ${sub}`);
}

async function cmdQueue(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sub = parsed.positional[0] ?? "list";

  if (sub === "clear") {
    await clearQueue();
    console.log("Cleared retry queue.");
    return;
  }

  if (sub === "list") {
    const items = await listQueuedUploads();
    if (items.length === 0) {
      console.log("Retry queue is empty.");
      return;
    }
    for (const item of items) {
      console.log(`${item.id}  ${item.title}  attempts:${item.attempts}${item.notBefore ? `  not-before:${item.notBefore}` : ""}`);
    }
    return;
  }

  if (sub === "run") {
    const items = await listQueuedUploads();
    if (items.length === 0) {
      console.log("Retry queue is empty.");
      return;
    }

    for (const item of items) {
      if (item.notBefore && new Date(item.notBefore).getTime() > Date.now()) {
        continue;
      }

      try {
        await publishUpload({
          title: item.title,
          description: item.description,
          locationName: item.locationName,
          locationValue: item.locationValue,
          placeName: item.placeName,
          street: item.street,
          locality: item.locality,
          region: item.region,
          postalCode: item.postalCode,
          country: item.country,
          cw: item.cw,
          exifMode: item.exifMode,
          mediaInputs: item.mediaInputs,
          altTexts: item.altTexts,
          altAi: item.altAi,
          scheduleAt: item.notBefore,
          queueIfOffline: false,
        });
        await removeQueuedUpload(item.id);
      } catch (error) {
        await updateQueuedUpload({
          ...item,
          attempts: item.attempts + 1,
        });
        console.log(`Queue item ${item.id} failed again: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return;
  }

  throw new GrainError("unknown_queue_command", `Unknown queue subcommand: ${sub}`);
}

async function cmdStyles(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const sub = parsed.positional[0] ?? "list";
  const config = (await loadConfig()) ?? {};
  const styles = config.styles ?? [];

  if (sub === "list") {
    if (styles.length === 0) {
      console.log("No styles saved.");
      return;
    }
    for (const style of styles) {
      console.log(`- ${style.name}`);
    }
    return;
  }

  const name = getOption(parsed.options, "name");
  if (!name) {
    throw new GrainError("missing_style_name", "Provide --name for this styles action.");
  }

  if (sub === "delete") {
    await saveConfig({
      ...config,
      styles: styles.filter((style) => style.name !== name),
    });
    console.log(`Deleted style ${name}.`);
    return;
  }

  if (sub === "save") {
    await upsertStyle({
      name,
      description: getOption(parsed.options, "description"),
      locationName: getOption(parsed.options, "location-name"),
      locationValue: getOption(parsed.options, "location-value"),
      placeName: getOption(parsed.options, "place-name"),
      street: getOption(parsed.options, "street"),
      locality: getOption(parsed.options, "locality"),
      region: getOption(parsed.options, "region"),
      postalCode: getOption(parsed.options, "postal-code"),
      country: getOption(parsed.options, "country"),
      cw: getOption(parsed.options, "cw"),
      exifMode: normalizeExifMode(getOption(parsed.options, "exif")),
    });
    console.log(`Saved style ${name}.`);
    return;
  }

  throw new GrainError("unknown_styles_command", `Unknown styles subcommand: ${sub}`);
}

async function run(): Promise<void> {
  const [, , ...argv] = process.argv;
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command) {
    await cmdStart();
    return;
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      printHelp();
      break;
    }
    case "start": {
      await cmdStart();
      break;
    }
    case "login": {
      await cmdLogin(rest);
      break;
    }
    case "whoami": {
      await cmdWhoAmI(rest);
      break;
    }
    case "logout": {
      await cmdLogout();
      break;
    }
    case "update": {
      await cmdUpdate();
      break;
    }
    case "auth": {
      await cmdAuth(rest);
      break;
    }
    case "upload-gallery": {
      await cmdUploadGallery(rest);
      break;
    }
    case "drafts": {
      await cmdDrafts(rest);
      break;
    }
    case "queue": {
      await cmdQueue(rest);
      break;
    }
    case "styles": {
      await cmdStyles(rest);
      break;
    }
    default: {
      throw new GrainError("unknown_command", `Unknown command: ${command}`, "Run `grain help` for command usage.");
    }
  }
}

run().catch((error) => {
  const issue = toGrainError(error);
  console.error(`Error [${issue.code}]: ${issue.message}`);
  if (issue.hint) {
    console.error(`Hint: ${issue.hint}`);
  }
  process.exitCode = 1;
}).finally(() => {
  process.stdin.pause();
});
