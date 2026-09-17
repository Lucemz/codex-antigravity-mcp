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
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, "agy");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
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
      diagnostics: "agy was not found. Install Antigravity CLI or set ANTIGRAVITY_AGY_PATH to an executable path."
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
      diagnostics: authenticated ? undefined : (models.stderr.trim() || "Unable to enumerate models; run agy interactively to authenticate.")
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
