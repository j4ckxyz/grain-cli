import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GrainError } from "./errors";

function currentProjectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function detectInstallRoot(): Promise<string> {
  const home = process.env.HOME;
  const preferred = home ? join(home, ".grain-cli") : undefined;

  if (preferred && (await fileExists(join(preferred, "scripts", "install.sh")))) {
    return preferred;
  }

  const root = currentProjectRoot();
  if (await fileExists(join(root, "scripts", "install.sh"))) {
    return root;
  }

  throw new GrainError(
    "update_script_missing",
    "Could not find the installer script for updates.",
    "Reinstall with the install script, then run `grain update` again.",
  );
}

function readOriginUrl(repoRoot: string): string | undefined {
  const result = Bun.spawnSync(["git", "-C", repoRoot, "remote", "get-url", "origin"], {
    stdout: "pipe",
    stderr: "ignore",
  });

  if (!result.success || !result.stdout) {
    return undefined;
  }

  const value = result.stdout.toString().trim();
  return value || undefined;
}

export async function runSelfUpdate(): Promise<void> {
  const installRoot = await detectInstallRoot();
  const scriptPath = join(installRoot, "scripts", "install.sh");

  const env = { ...process.env };
  const originUrl = readOriginUrl(installRoot);
  if (originUrl) {
    env.GRAIN_REPO_URL = originUrl;
  }

  console.log("Updating grain to the latest release...");
  const proc = Bun.spawn(["bash", scriptPath], {
    cwd: installRoot,
    env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new GrainError("update_failed", "Update failed.", "Re-run `grain update` or reinstall using the install script.");
  }

  console.log("Update complete.");
}
