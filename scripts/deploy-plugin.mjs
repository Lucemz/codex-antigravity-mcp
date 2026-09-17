import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "plugin");
const dist = resolve(root, "dist");
const bin = resolve(root, "bin");
const skills = resolve(root, "plugin/skills");
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
  if (existsSync(bin)) {
    cpSync(bin, resolve(destination, "bin"), { recursive: true });
  }

  const runShPath = resolve(destination, "bin/run.sh");
  if (existsSync(runShPath)) {
    try { chmodSync(runShPath, 0o755); } catch {}
  }

  // Ensure .mcp.json in deployed destination uses universal launcher
  const mcpPayload = {
    mcpServers: {
      antigravity: {
        command: "bash",
        args: [runShPath]
      }
    }
  };
  writeFileSync(resolve(destination, ".mcp.json"), `${JSON.stringify(mcpPayload, null, 2)}\n`);

  // 1. Copy skills to ~/.codex/skills/ for Codex Desktop
  const codexSkillsDir = resolve(homedir(), ".codex/skills");
  if (existsSync(skills)) {
    try {
      mkdirSync(codexSkillsDir, { recursive: true });
      cpSync(skills, codexSkillsDir, { recursive: true });
    } catch {}
  }

  // 2. Automatically configure [mcp_servers.antigravity] in ~/.codex/config.toml
  const configTomlPath = resolve(homedir(), ".codex/config.toml");
  try {
    let tomlContent = "";
    if (existsSync(configTomlPath)) {
      tomlContent = readFileSync(configTomlPath, "utf8");
    }

    const antigravitySection = `[mcp_servers.antigravity]\ncommand = "bash"\nargs = ["${runShPath}"]\n`;

    if (tomlContent.includes("[mcp_servers.antigravity]")) {
      // Replace existing section
      tomlContent = tomlContent.replace(/\[mcp_servers\.antigravity\][^\[]*/g, antigravitySection);
    } else {
      // Append section
      tomlContent = `${antigravitySection}\n${tomlContent}`;
    }

    writeFileSync(configTomlPath, tomlContent);
    process.stdout.write(`Configured MCP server in ${configTomlPath}\n`);
  } catch (e) {
    process.stderr.write(`Could not auto-update config.toml: ${e.message}\n`);
  }

  // 3. Register in local personal marketplace files
  const marketplacePaths = [
    resolve(homedir(), ".agents/plugins/marketplace.json"),
    resolve(homedir(), ".codex/marketplace.json")
  ];

  for (const mpPath of marketplacePaths) {
    try {
      let mpData = { name: "personal", interface: { displayName: "Personal Marketplace" }, plugins: [] };
      if (existsSync(mpPath)) {
        mpData = JSON.parse(readFileSync(mpPath, "utf8"));
      } else {
        mkdirSync(resolve(mpPath, ".."), { recursive: true });
      }

      if (!Array.isArray(mpData.plugins)) mpData.plugins = [];
      const pluginEntry = {
        name: "codex-antigravity",
        source: {
          source: "local",
          path: destination
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: "Development"
      };

      const existingIndex = mpData.plugins.findIndex(p => (typeof p === "object" && p && p.name === "codex-antigravity") || p === "codex-antigravity");
      if (existingIndex >= 0) {
        mpData.plugins[existingIndex] = pluginEntry;
      } else {
        mpData.plugins.push(pluginEntry);
      }

      writeFileSync(mpPath, `${JSON.stringify(mpData, null, 2)}\n`);
    } catch {}
  }

  rmSync(backup, { recursive: true, force: true });
  process.stdout.write(`\n✅ Installed plugin successfully at ${destination}\n`);
} catch (error) {
  rmSync(destination, { recursive: true, force: true });
  if (existsSync(backup)) renameSync(backup, destination);
  throw error;
}
