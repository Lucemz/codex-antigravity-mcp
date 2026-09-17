import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const candidates = [
  process.env.CODEX_CLI_PATH,
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  "codex"
].filter(Boolean);

let reinstalled = false;
for (const command of candidates) {
  if (command.includes("/") && !existsSync(command)) continue;
  try {
    execFileSync(command, ["plugin", "add", "codex-antigravity@personal"], { stdio: "ignore" });
    reinstalled = true;
    process.stdout.write("Codex CLI plugin state reloaded.\n");
    break;
  } catch {
    // If CLI is not present or failed, continue
  }
}

if (!reinstalled) {
  process.stdout.write("Note: Codex CLI is not in PATH. If using Codex Desktop, restart Codex Desktop or reload plugins in the app UI to apply changes.\n");
}
