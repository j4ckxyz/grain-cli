import { getOption, getOptionList, hasOption, parseArgs } from "./args";
import { resolveDidToPds, resolveHandleToDid } from "./atproto";
import { GrainError, toGrainError } from "./errors";
import { parseContentWarnings, uploadGallery, validateUploadOptions } from "./gallery";
import { buildGrainGalleryUrl, buildGrainLibraryUrl } from "./links";
import { normalizeLocalPathToken, parsePositionalMediaToken } from "./media-input";
import { getAuthorizedAgent, loginWithOAuth, logoutOAuth } from "./oauth";
import { promptForAltTextFallback, runUploadWizard } from "./tui";
import type { AltAiConfig, MediaInput } from "./types";
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

CLI for posting Grain.social galleries.

Login uses secure browser-based sign-in.

Defaults:
  - AI alt text: disabled (opt-in)
  - EXIF metadata: included
  - Location metadata: optional but recommended for better gallery context

Commands:
  grain help
  grain login [--handle <handle>]
  grain whoami [--debug]
  grain update
  grain logout
  grain upload-gallery --title <title> [--description <text>] [--location-name <name>] [--location-value <h3>] [--country <code>] [--locality <name>] [--region <name>] [--street <value>] [--postal-code <code>] [--place-name <name>] [--cw <label1,label2>] [--alt <text> ...] [--image <path> ...] [--image-url <url> ...] [--exif include|exclude] [--alt-ai-endpoint <url> --alt-ai-api-key <key> --alt-ai-model <model>] <image-path-or-url ...>

Run without a command to start the interactive upload wizard.

Examples:
  grain login --handle j4ck.xyz
  grain upload-gallery --title "Morning walk" --description "Hi @alice.com #nature https://example.com" --image @img1.jpg --image-url https://example.com/pic.jpg --exif include
`);
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
      process.stdin.once("data", (chunk) => resolve(String(chunk).trim()));
    });

    if (value || allowEmpty) {
      return value;
    }
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
  console.log(`DID: ${result.did}`);
  console.log(`Grain library: ${result.libraryUrl}`);
}

async function cmdWhoAmI(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const debug = hasOption(parsed.options, "debug");
  const { did, handle } = await getAuthorizedAgent(false);

  console.log(`Handle: ${handle}`);
  console.log(`Grain library: ${buildGrainLibraryUrl(did)}`);

  if (!debug) {
    return;
  }

  const didFromHandle = await resolveHandleToDid(handle);
  const pdsFromDid = await resolveDidToPds(did);
  console.log(`DID: ${did}`);
  console.log(`Resolved DID from handle: ${didFromHandle}`);
  console.log(`Resolved PDS from DID: ${pdsFromDid}`);
}

async function cmdLogout(): Promise<void> {
  await logoutOAuth();
  console.log("Logged out and removed saved OAuth session.");
}

async function cmdUpdate(): Promise<void> {
  await runSelfUpdate();
}

function parseAltAi(parsed: ReturnType<typeof parseArgs>): AltAiConfig | undefined {
  const endpoint = getOption(parsed.options, "alt-ai-endpoint") ?? process.env.GRAIN_ALT_AI_ENDPOINT;
  const apiKey = getOption(parsed.options, "alt-ai-api-key") ?? process.env.GRAIN_ALT_AI_API_KEY;
  const model = getOption(parsed.options, "alt-ai-model") ?? process.env.GRAIN_ALT_AI_MODEL;

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
  };
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

async function cmdUploadGallery(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const { agent, did } = await getAuthorizedAgent(false);

  const title = requireOption(parsed.options, "title");
  const description = getOption(parsed.options, "description");
  const locationName = getOption(parsed.options, "location-name");
  const locationValue = getOption(parsed.options, "location-value");
  const mediaInputs = parseMediaInputs(parsed);
  const altTexts = normalizeManualAltList(getOptionList(parsed.options, "alt"));
  const altAi = parseAltAi(parsed);
  const exifMode = normalizeExifMode(getOption(parsed.options, "exif"));

  const warningsRaw = getOption(parsed.options, "cw");
  const contentWarnings = parseContentWarnings(warningsRaw);

  const address = {
    name: getOption(parsed.options, "place-name"),
    street: getOption(parsed.options, "street"),
    locality: getOption(parsed.options, "locality"),
    region: getOption(parsed.options, "region"),
    postalCode: getOption(parsed.options, "postal-code"),
    country: getOption(parsed.options, "country"),
  };

  validateUploadOptions({
    agent,
    did,
    title,
    description,
    locationName,
    locationValue,
    address,
    contentWarnings,
    mediaInputs,
    altTexts,
    altAi,
    exifMode,
  });

  console.log(`Uploading ${mediaInputs.length} image(s) to Grain.social...`);
  const result = await uploadGallery({
    agent,
    did,
    title,
    description,
    locationName,
    locationValue,
    address,
    contentWarnings,
    mediaInputs,
    altTexts,
    altAi,
    exifMode,
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
}

async function cmdWizard(): Promise<void> {
  const { agent, did } = await getAuthorizedAgent(false);
  const wizard = await runUploadWizard();

  if (!wizard.locationName) {
    console.log("Tip: adding location improves discovery and search context.");
  }

  validateUploadOptions({
    agent,
    did,
    title: wizard.title,
    description: wizard.description,
    locationName: wizard.locationName,
    locationValue: wizard.locationValue,
    address: {
      name: wizard.placeName,
      street: wizard.street,
      locality: wizard.locality,
      region: wizard.region,
      postalCode: wizard.postalCode,
      country: wizard.country,
    },
    contentWarnings: parseContentWarnings(wizard.cw),
    mediaInputs: wizard.mediaInputs,
    altTexts: wizard.altTexts,
    altAi: wizard.altAi,
    exifMode: wizard.exifMode,
  });

  console.log(`Uploading ${wizard.mediaInputs.length} image(s) to Grain.social...`);
  const result = await uploadGallery({
    agent,
    did,
    title: wizard.title,
    description: wizard.description,
    locationName: wizard.locationName,
    locationValue: wizard.locationValue,
    address: {
      name: wizard.placeName,
      street: wizard.street,
      locality: wizard.locality,
      region: wizard.region,
      postalCode: wizard.postalCode,
      country: wizard.country,
    },
    contentWarnings: parseContentWarnings(wizard.cw),
    mediaInputs: wizard.mediaInputs,
    altTexts: wizard.altTexts,
    altAi: wizard.altAi,
    exifMode: wizard.exifMode,
    onAltTextNeeded: promptForAltTextFallback,
  });

  const galleryUrl = buildGrainGalleryUrl(result.galleryUri);
  console.log(`Created gallery: ${result.galleryUri}`);
  if (galleryUrl) {
    console.log(`Gallery URL: ${galleryUrl}`);
  }
  console.log(`Grain library: ${buildGrainLibraryUrl(did)}`);
}

async function run(): Promise<void> {
  const [, , ...argv] = process.argv;
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command) {
    await cmdWizard();
    return;
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h": {
      printHelp();
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
    case "upload-gallery": {
      await cmdUploadGallery(rest);
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
});
