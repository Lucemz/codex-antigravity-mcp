import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const destination = process.env.CODEX_PLUGINS_DIR
  ? resolve(process.env.CODEX_PLUGINS_DIR, "codex-antigravity")
  : resolve(homedir(), "plugins/codex-antigravity");
const archived = `${destination}.removed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
if (existsSync(destination)) {
  renameSync(destination, archived);
  process.stdout.write(`Plugin moved to ${archived}\n`);
} else process.stdout.write("Plugin is not installed.\n");
