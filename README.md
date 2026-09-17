# Codex Antigravity MCP (`codex-antigravity-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 1.0.0](https://img.shields.io/badge/version-1.0.0-green.svg)](package.json)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

Local Model Context Protocol (MCP) server that empowers **Codex** to delegate complex engineering tasks to **Google Antigravity CLI (`agy`)** as an autonomous, persistent coding subagent.

---

## 🌟 Highlights & Features

- 🤖 **Codex as Supervisor, Antigravity as Autonomous Subagent**: Codex orchestrates workflows, while Antigravity (powered by Gemini models) executes code modifications, tests, builds, and Git workflows.
- ⚡ **Sliding Inactivity Heartbeat**: 10-minute activity window that automatically refreshes whenever Antigravity performs an action (tool calls, file edits, streamed output). Long tasks never time out prematurely.
- 🔄 **Persistent Multi-Turn Sessions**: Maintains conversation state and context across multiple turns without needing to rebuild project index each time.
- 🛡️ **Headless Autonomy & Permission Management**: Executes non-blocking tool calls within the declared workspace (`--dangerously-skip-permissions`), preventing headless process deadlocks.
- 📁 **Monorepo & Multi-Repo Aware**: Automatically detects nested repositories (e.g. `frontend/.git`, `backend/.git`) and executes Git and build operations in the correct subprojects.
- 📊 **Structured Diagnostics & Recovery**: Captures partial streamed text, invoked tool logs, and bounded `stderr` diagnostics even if an error occurs. Automatically retries empty responses.

---

## 📋 Prerequisites

Before installing the plugin, ensure you have the following installed on your system:

1. **Node.js** (v20.0.0 or higher) and `npm`.
2. **Google Antigravity CLI (`agy`)**:
   - The CLI interface to Google Antigravity and Gemini models.
   - Install and authenticate `agy` on your machine:
     ```sh
     # Verify agy is installed and accessible in your PATH
     agy --version
     
     # Authenticate your account (interactive login)
     agy
     
     # Check available models
     agy models
     ```
   - If `agy` is installed in a non-standard path, set the environment variable:
     ```sh
     export ANTIGRAVITY_AGY_PATH="/path/to/your/agy"
     ```

---

## 🚀 Installation & Setup

### 1. Clone & Build the Repository

```sh
git clone https://github.com/Lucemz/codex-antigravity-mcp.git
cd codex-antigravity-mcp
npm install
npm test
npm run build
```

### 2. Install as a Codex Plugin

Run the automated installer script to deploy to your personal Codex plugins directory (`~/plugins/codex-antigravity`):

```sh
npm run install:plugin
```

### 3. Manual MCP Configuration (Optional)

If you are using Codex or any other MCP client directly via `.mcp.json` or `config.json`:

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "node",
      "args": ["/path/to/codex-antigravity-mcp/dist/index.mjs"],
      "env": {
        "ANTIGRAVITY_AGY_PATH": "agy"
      }
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Description |
| :--- | :--- |
| `antigravity_status` | Checks `agy` binary presence, available Gemini models, authentication status, and limits. |
| `antigravity_session_create` | Creates a persistent multi-turn Antigravity session inside a target workspace `cwd`. |
| `antigravity_session_prompt` | Sends a prompt to an active persistent session and waits for structured results. |
| `antigravity_session_list` | Lists all active sessions, their state (`idle`/`running`), and queued turns. |
| `antigravity_session_close` | Closes and cleans up a persistent session process. |
| `antigravity_run` | Runs a single, isolated Antigravity turn (auto-closes session upon completion). |

### Key Parameters:
- `mode`: `"plan"` (read-only inspection and analysis) or `"accept-edits"` (full authorization to write files, run tests, and manage git branches).
- `skipPermissions`: `true` (default) allows autonomous tool execution in headless mode.
- `subagents`: `"auto"` (default), `"required"`, or `"off"`.
- `model`: Optional Gemini model ID (e.g., `gemini-3.7-flash-medium`, `gemini-3.8-flash-high`, `gemini-3.1-pro-high`).

---

## 💡 Usage Examples from Codex

In Codex, mention or tag `@Codex Antigravity` to supervise Antigravity:

### 1. Full Development, Branching & Testing (`accept-edits`)
```text
@Codex Antigravity en /ruta/a/mi-proyecto:
Crea una sesión persistente en mode "accept-edits".
1. Crea una rama git 'feature/nueva-funcionalidad'.
2. Implementa los cambios solicitados en el código.
3. Ejecuta la suite de pruebas y linters del proyecto.
4. Si las pruebas pasan, haz un commit con los cambios y devuelve el diff y resumen.
```

### 2. Deep Architectural Review & Audit (`plan`)
```text
@Codex Antigravity en /ruta/a/mi-proyecto:
Crea una sesión persistente en mode "plan".
Analiza la arquitectura del backend, revisa posibles cuellos de botella de rendimiento y genera un informe detallado con prioridades.
```

### 3. Multi-Repo / Monorepos
```text
@Codex Antigravity en /ruta/a/monorepo:
Crea una sesión en mode "accept-edits".
Dentro del subproyecto 'backend-api':
1. Añade validación de esquemas en las rutas de usuarios.
2. Ejecuta los tests de 'backend-api'.
3. Reporta los resultados.
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `ANTIGRAVITY_AGY_PATH` | `agy` (from `PATH`) | Absolute path to the Antigravity CLI executable. |
| `ANTIGRAVITY_SKIP_PERMISSIONS` | `1` (true) | Set `0` to disable `--dangerously-skip-permissions`. |
| `ANTIGRAVITY_TURN_TIMEOUT_MS` | `600000` (10 min) | Inactivity timeout window per turn. |
| `CODEX_PLUGINS_DIR` | `~/plugins` | Target directory for Codex plugin installation. |

---

## 🧪 Testing

The repository includes a comprehensive unit test suite with mock binaries to test process serialization, timeout heartbeat, recovery, and error resilience:

```sh
npm test
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
