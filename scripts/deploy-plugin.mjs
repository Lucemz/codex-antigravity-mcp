import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const destination = process.env.CODEX_PLUGINS_DIR
  ? resolve(process.env.CODEX_PLUGINS_DIR, "codex-antigravity")
  : resolve(homedir(), "plugins/codex-antigravity");
const source = resolve(root, "plugin");
const dist = resolve(root, "dist");
const backup = `${destination}.previous`;
if (!existsSync(resolve(dist, "index.mjs"))) throw new Error("Run npm run build first.");
if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
if (existsSync(destination)) renameSync(destination, backup);
try {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  cpSync(dist, resolve(destination, "dist"), { recursive: true });
  const launcher = resolve(destination, "bin/run.sh");
  chmodSync(launcher, 0o755);
  writeFileSync(resolve(destination, ".mcp.json"), `${JSON.stringify({ mcpServers: { antigravity: { command: "./bin/run.sh", args: [], cwd: "." } } }, null, 2)}\n`);
  rmSync(backup, { recursive: true, force: true });
  console.log(`Installed plugin artifact at ${destination}`);
  console.log("Register this repository once in Codex Plugins; no global files were modified.");
} catch (error) {
  rmSync(destination, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, destination);
  throw error;
}
