import { chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "./types";

const CONFIG_DIRNAME = "grain-cli";
const CONFIG_FILENAME = "config.json";

export function getConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return join(xdgConfigHome, CONFIG_DIRNAME, CONFIG_FILENAME);
  }

  const home = process.env.HOME;
  if (!home) {
    throw new Error("Could not resolve HOME for config path.");
  }

  return join(home, ".config", CONFIG_DIRNAME, CONFIG_FILENAME);
}

export async function loadConfig(): Promise<AppConfig | null> {
  const path = getConfigPath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }

  const text = await file.text();
  const parsed = JSON.parse(text) as AppConfig;
  if (parsed.oauth) {
    if (!parsed.oauth.activeDid || !parsed.oauth.handle || !parsed.oauth.clientId || !parsed.oauth.loginAt) {
      throw new Error(`Invalid OAuth config format at ${path}`);
    }
  }
  if (parsed.altAi) {
    if (!parsed.altAi.endpoint || !parsed.altAi.apiKey || !parsed.altAi.model) {
      throw new Error(`Invalid alt AI config format at ${path}`);
    }
  }
  return parsed;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
  await chmod(path, 0o600);
}
