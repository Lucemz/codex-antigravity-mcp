import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const candidates = [
  process.env.CODEX_CLI_PATH,
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "codex"
].filter(Boolean);

let lastError;
for (const command of candidates) {
  if (command.includes("/") && !existsSync(command)) continue;
  try {
    execFileSync(command, ["plugin", "add", "codex-antigravity@personal"], { stdio: "inherit" });
    process.exit(0);
  } catch (error) {
    lastError = error;
  }
}

throw new Error(`Could not reinstall codex-antigravity@personal. Set CODEX_CLI_PATH to a working Codex CLI. ${lastError instanceof Error ? lastError.message : ""}`);
