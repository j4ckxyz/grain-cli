import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GrainError } from "./errors";

export async function getGrainVersion(repoRoot?: string): Promise<string> {
  const root = repoRoot ?? currentProjectRoot();
  const pkg = Bun.file(join(root, "package.json"));
  if (!(await pkg.exists())) {
    return "unknown";
  }
  const parsed = (await pkg.json()) as { version?: string };
  return parsed.version ?? "unknown";
}

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

function readHeadCommit(repoRoot: string): string | undefined {
  const result = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!result.success || !result.stdout) {
    return undefined;
  }
  return result.stdout.toString().trim() || undefined;
}

function readRemoteHead(repoRoot: string): string | undefined {
  const result = Bun.spawnSync(["git", "-C", repoRoot, "ls-remote", "origin", "main"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!result.success || !result.stdout) {
    return undefined;
  }
  const line = result.stdout.toString().trim();
  if (!line) {
    return undefined;
  }
  return line.split("\t")[0] || undefined;
}

function shortSha(sha: string | undefined): string {
  if (!sha) {
    return "unknown";
  }
  return sha.slice(0, 7);
}

export async function runSelfUpdate(): Promise<void> {
  const installRoot = await detectInstallRoot();
  const scriptPath = join(installRoot, "scripts", "install.sh");
  const version = await getGrainVersion(installRoot);

  const localHead = readHeadCommit(installRoot);
  const remoteHead = readRemoteHead(installRoot);
  if (localHead && remoteHead && localHead === remoteHead) {
    console.log(`You're already on the latest grain release (v${version}, ${shortSha(localHead)}).`);
    return;
  }

  const env = { ...process.env };
  const originUrl = readOriginUrl(installRoot);
  if (originUrl) {
    env.GRAIN_REPO_URL = originUrl;
  }

  console.log("Checking for updates...");
  console.log(`Current: v${version} (${shortSha(localHead)})`);
  console.log(`Latest : ${shortSha(remoteHead)}`);
  console.log("Installing update...");
  const proc = Bun.spawnSync(["bash", scriptPath], {
    cwd: installRoot,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!proc.success) {
    const stdout = proc.stdout.toString().trim();
    const stderr = proc.stderr.toString().trim();
    const detail = stderr || stdout;
    throw new GrainError(
      "update_failed",
      detail ? `Update failed: ${detail.split("\n").slice(-1)[0]}` : "Update failed.",
      "Re-run `grain update` or reinstall using the install script.",
    );
  }

  const nextHead = readHeadCommit(installRoot);
  const nextVersion = await getGrainVersion(installRoot);
  console.log(`Update complete. You're now on v${nextVersion} (${shortSha(nextHead)}).`);
}
