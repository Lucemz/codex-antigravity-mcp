import { accessSync, constants, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface AgyStatus {
  available: boolean;
  binary?: string;
  version?: string;
  models?: string[];
  authentication: "ready" | "unavailable" | "unknown";
  diagnostics?: string;
}

export function findAgy(env = process.env): string | undefined {
  const explicit = env.ANTIGRAVITY_AGY_PATH;
  if (explicit) {
    try {
      accessSync(explicit, constants.X_OK);
      return explicit;
    } catch {
      return undefined;
    }
  }

  // 1. Check directories in PATH
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "agy");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
    }
  }

  // 2. Check well-known installation locations on macOS & Linux
  const home = env.HOME || process.env.USERPROFILE || "";
  const standardLocations = [
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy",
    join(home, ".gemini/antigravity/bin/agy"),
    join(home, ".gemini/antigravity-cli/bin/agy"),
    join(home, ".gemini/antigravity-cli/agy"),
    join(home, ".gemini/antigravity/agy"),
    join(home, ".local/bin/agy"),
    join(home, "bin/agy"),
    "/Applications/Antigravity.app/Contents/Resources/agy",
    "/Applications/Antigravity.app/Contents/MacOS/agy"
  ];

  for (const candidate of standardLocations) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next
    }
  }

  return undefined;
}

export function runCommand(binary: string, args: string[], timeoutMs = 30_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function inspectAgy(): Promise<AgyStatus> {
  const binary = findAgy();
  if (!binary) {
    return {
      available: false,
      authentication: "unavailable",
      diagnostics: "Google Antigravity CLI ('agy') was not found. Please install Antigravity CLI or set ANTIGRAVITY_AGY_PATH. Visit https://antigravity.google/docs/cli/reference for installation instructions."
    };
  }
  try {
    const version = await runCommand(binary, ["--version"]);
    const models = await runCommand(binary, ["models"]);
    const authenticated = models.code === 0;
    return {
      available: true,
      binary,
      version: version.stdout.trim() || undefined,
      models: models.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
      authentication: authenticated ? "ready" : "unknown",
      diagnostics: authenticated ? undefined : (models.stderr.trim() || "Unable to enumerate models; run 'agy' interactively in terminal to authenticate your Google Antigravity account.")
    };
  } catch (error) {
    return {
      available: true,
      binary,
      authentication: "unknown",
      diagnostics: error instanceof Error ? error.message : String(error)
    };
  }
}

export function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
