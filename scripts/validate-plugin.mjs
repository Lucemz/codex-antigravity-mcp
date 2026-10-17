import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function assertFile(relativePath, executable = false) {
  const full = resolve(root, relativePath);
  if (!existsSync(full)) {
    throw new Error(`Missing required plugin file: ${relativePath}`);
  }
  if (executable) {
    accessSync(full, constants.X_OK);
  }
  return full;
}

const pkg = JSON.parse(readFileSync(assertFile("package.json"), "utf8"));
const pluginManifest = JSON.parse(readFileSync(assertFile("plugin/.codex-plugin/plugin.json"), "utf8"));
const marketplaceManifest = JSON.parse(readFileSync(assertFile(".agents/plugins/marketplace.json"), "utf8"));
const mcpConfig = JSON.parse(readFileSync(assertFile("plugin/.mcp.json"), "utf8"));

assertFile("plugin/bin/run.sh", true);
assertFile("plugin/skills/delegate-with-antigravity/SKILL.md");
assertFile("dist/index.mjs");
assertFile("plugin/dist/index.mjs");

if (pluginManifest.name !== "codex-antigravity") {
  throw new Error(`Invalid plugin name in plugin.json: ${pluginManifest.name}`);
}
if (pluginManifest.version !== pkg.version) {
  throw new Error(`Version mismatch: package.json (${pkg.version}) vs plugin.json (${pluginManifest.version})`);
}
const mpPlugin = marketplaceManifest.plugins?.[0];
if (!mpPlugin || mpPlugin.version !== pkg.version) {
  throw new Error(`Version mismatch: package.json (${pkg.version}) vs marketplace.json (${mpPlugin?.version})`);
}
if (!mcpConfig.mcpServers?.antigravity?.command) {
  throw new Error("Missing mcpServers.antigravity.command in plugin/.mcp.json");
}

process.stdout.write(`Plugin validation passed (${pluginManifest.name}@${pluginManifest.version}).\n`);
