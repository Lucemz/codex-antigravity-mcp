import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "plugin");
const dist = resolve(root, "dist");
const destination = process.env.CODEX_PLUGINS_DIR
  ? resolve(process.env.CODEX_PLUGINS_DIR, "codex-antigravity")
  : resolve(homedir(), "plugins/codex-antigravity");
const backup = `${destination}.previous`;

if (!existsSync(resolve(dist, "index.mjs"))) throw new Error("Build output dist/index.mjs is missing.");
if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
if (existsSync(destination)) renameSync(destination, backup);
try {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  cpSync(dist, resolve(destination, "dist"), { recursive: true });
  writeFileSync(resolve(destination, ".mcp.json"), `${JSON.stringify({ mcpServers: { antigravity: { command: process.execPath, args: [resolve(destination, "dist/index.mjs")], cwd: destination } } }, null, 2)}\n`);
  rmSync(backup, { recursive: true, force: true });
  process.stdout.write(`Installed plugin at ${destination}\n`);
} catch (error) {
  rmSync(destination, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, destination);
  throw error;
}
