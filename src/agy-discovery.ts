import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, join } from "node:path";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ModelDetail {
  id: string;
  label: string;
}

export interface AgyCapabilities {
  imageGeneration: boolean;
  videoEncoding: boolean;
  goBinary?: string;
  ffmpegBinary?: string;
  webmEncoderBinary?: string;
  settingsPermissions?: {
    toolPermission?: string;
    artifactReviewPolicy?: string;
    allowNonWorkspaceAccess?: boolean;
    enableTerminalSandbox?: boolean;
  };
}

export interface AgyStatus {
  available: boolean;
  binary?: string;
  version?: string;
  models?: string[];
  modelDetails?: ModelDetail[];
  authentication: "ready" | "unavailable" | "unknown";
  capabilities?: AgyCapabilities;
  diagnostics?: string;
}

export function buildSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = baseEnv.HOME || process.env.USERPROFILE || "";
  const extraDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/local/go/bin",
    home ? join(home, "go/bin") : "",
    home ? join(home, ".cargo/bin") : "",
    home ? join(home, ".gemini/antigravity-cli/bin") : "",
    home ? join(home, ".gemini/antigravity/bin") : "",
    home ? join(home, ".local/bin") : "",
    home ? join(home, "bin") : ""
  ].filter(Boolean);

  const currentParts = (baseEnv.PATH ?? "").split(delimiter).filter(Boolean);
  const merged = [...currentParts];
  for (const dir of extraDirs) {
    if (!merged.includes(dir) && existsSync(dir)) {
      merged.unshift(dir);
    }
  }
  return {
    ...baseEnv,
    PATH: merged.join(delimiter),
    AGY_CLI_OSC7501: "off"
  };
}

export function findExecutableInEnv(name: string, env = buildSpawnEnv()): string | undefined {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try next
    }
  }
  return undefined;
}

export function inspectCapabilities(env = buildSpawnEnv()): AgyCapabilities {
  const home = env.HOME || process.env.USERPROFILE || "";
  const goBinary = findExecutableInEnv("go", env);
  const ffmpegBinary = findExecutableInEnv("ffmpeg", env);
  const webmEncoderBinary = findExecutableInEnv("webm_encoder", env);
  let settingsPermissions: AgyCapabilities["settingsPermissions"];
  if (home) {
    const settingsPath = join(home, ".gemini/antigravity-cli/settings.json");
    try {
      if (existsSync(settingsPath)) {
        const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
        settingsPermissions = {
          toolPermission: typeof parsed.toolPermission === "string" ? parsed.toolPermission : undefined,
          artifactReviewPolicy: typeof parsed.artifactReviewPolicy === "string" ? parsed.artifactReviewPolicy : undefined,
          allowNonWorkspaceAccess: typeof parsed.allowNonWorkspaceAccess === "boolean" ? parsed.allowNonWorkspaceAccess : false,
          enableTerminalSandbox: typeof parsed.enableTerminalSandbox === "boolean" ? parsed.enableTerminalSandbox : false
        };
      }
    } catch {
      // Ignore malformed settings.json
    }
  }
  return {
    imageGeneration: true,
    videoEncoding: Boolean(webmEncoderBinary || ffmpegBinary),
    goBinary,
    ffmpegBinary,
    webmEncoderBinary,
    settingsPermissions
  };
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
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSpawnEnv(process.env)
    });
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

export function parseModelsOutput(raw: string): { models: string[]; modelDetails: ModelDetail[] } {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter(Boolean);
  const modelDetails: ModelDetail[] = [];
  for (const line of lines) {
    const parts = line.split(/\t+|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const id = parts[0];
    const label = parts.slice(1).join(" ") || id;
    modelDetails.push({ id, label });
  }
  return {
    models: modelDetails.map((m) => m.id),
    modelDetails
  };
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
    const modelsResult = await runCommand(binary, ["models"]);
    const authenticated = modelsResult.code === 0;
    const parsed = parseModelsOutput(modelsResult.stdout);
    return {
      available: true,
      binary,
      version: version.stdout.trim() || undefined,
      models: parsed.models,
      modelDetails: parsed.modelDetails,
      authentication: authenticated ? "ready" : "unknown",
      capabilities: inspectCapabilities(),
      diagnostics: authenticated ? undefined : (modelsResult.stderr.trim() || "Unable to enumerate models; run 'agy' interactively in terminal to authenticate your Google Antigravity account.")
    };
  } catch (error) {
    return {
      available: true,
      binary,
      authentication: "unknown",
      capabilities: inspectCapabilities(),
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
