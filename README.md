# Codex Antigravity MCP (`codex-antigravity-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 2.0.0](https://img.shields.io/badge/version-2.0.0-green.svg)](package.json)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

Plugin and MCP server for **Codex** (Desktop & CLI) that delegates software engineering, refactoring, architectural auditing, git branch management, and test execution to **Google Antigravity CLI (`agy`)** as a persistent autonomous coding subagent with a real-time **Live Activity Channel**.

## What's New in v2.0.0

- Compact text output is now the default for tools. Running turns show `[RUNNING]`, `stateDetail`, up to eight recent new steps, and `cursor`; each live preview is capped at 300 characters on one line. Omitted steps are counted.
- Completed turns show an `activity:` summary followed by the final Markdown response. Partial responses and cumulative workspace activity are not repeated on each live poll.
- Pass `verbose: true` to status, create, prompt, watch, interrupt, list, or run to get the full JSON payload. The live resource `antigravity://sessions/live` now returns a compact `text/plain` session list.

### Migrating from 1.2.0

This release changes the default output format. Clients that parse tool text with `JSON.parse` must send `verbose: true`; JSON turn responses retain `status`, `events`, `timeline`, `workspaceActivity`, `cumulativeUsage`, and `nextCursor`. Close confirmations and handler exceptions now return text even when other requests use verbose mode.

For compact live monitoring, pass the returned `cursor` to the next watch call. To inspect omitted events, repeat the watch with `verbose: true` and the **previous input cursor** before advancing. The session retains at most 500 events, so older events can expire from the buffer.

## Session and Media Features

- **Live Activity Channel (`antigravity_session_watch` + `waitMs`)**: Codex observes what `agy` is doing step by step in real time (reasoning thoughts, intermediate messages, files read/modified via `view_file` / `replace_file_content`, shell commands executed via `run_command`, and spawned subagents) with a default 20-second observation window that returns `[RUNNING]` updates without interrupting the turn.
- **Hot Interrupt & Steering (`antigravity_session_interrupt`)**: Stop or redirect an active turn mid-flight while automatically reconnecting to the same `conversationId` via `--conversation`.
- **Workspace Impact, Media & Token Tracking (`workspaceActivity` & `cumulativeUsage`)**: Completed compact responses summarize files read/modified, commands, and generated media (photos, icons, screenshots, WebM/MP4 videos). Verbose JSON includes `workspaceActivity` and cumulative token consumption, plus on-demand context compaction (`compact: true` via `/compact`).
- **Photo, Image, Screenshot & Video Generation Support**: Full support for `agy`'s built-in `image-generator` subagent (`generate_image`), browser screenshot/video capture (`capture_browser_screenshot`, `browser_subagent`, `webm_encoder`), and `ffmpeg` / `sips` / `go` PATH injection (`buildSpawnEnv`).
- **Native MCP Real-Time Notifications & Eager Tool Loading**: Emits `notifications/progress` and `notifications/message` on every `step_update`, exposes `antigravity://sessions/live`, and marks all tools with `_meta: { "antigravity/alwaysLoad": true }`.
- **Full `agy 1.4.0` Compatibility**:
  - Supports `mode: "auto"` (in addition to `"plan"` and `"accept-edits"`).
  - Supports reasoning `effort: "low" | "medium" | "high" | "xhigh" | "max"`.
  - Supports multi-directory workspaces (`addDirs` via `--add-dir`), conversation resumption (`conversationId` via `--conversation`), and clean model catalog parsing (`modelDetails`).

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Install Node.js (v18+)
- **macOS (Homebrew)**:
  ```sh
  brew install node
  ```
- Or download the official installer from [nodejs.org](https://nodejs.org).

### Step 2: Install and Authenticate Google Antigravity CLI (`agy`)
1. Install `agy` following the [official Antigravity CLI documentation](https://antigravity.google/docs/cli/reference).
2. Open your terminal, update to the latest version (`1.4.0+`), and sign in:
   ```sh
   agy --version
   agy update
   agy
   agy models
   ```

> 💡 **Note:** If `agy` is installed in a custom path outside `PATH`, set `export ANTIGRAVITY_AGY_PATH="/path/to/agy"`.

### Step 3: Clone, Build, and Install the Plugin Locally
```sh
git clone https://github.com/Lucemz/codex-antigravity-mcp.git
cd codex-antigravity-mcp
npm install
npm run build
npm run install:plugin
```

### Step 4: Enable in Codex Desktop
1. Open **Codex Desktop**.
2. Go to **Plugins** / **Marketplace**.
3. Click **Add Marketplace / Add Repository** and enter:
   ```text
   https://github.com/Lucemz/codex-antigravity-mcp
   ```
4. Click **Install**.
5. **Restart Codex Desktop (`Cmd + Q`)** or open a **New Chat** to load the MCP tools.

---

## 🛠️ Available MCP Tools

| Tool | Description |
| :--- | :--- |
| `antigravity_status` | Checks the local `agy` binary, version, clean `models` / `modelDetails` catalog, authentication state, and adapter limits. |
| `antigravity_session_create` | Starts a persistent multi-turn session in `cwd` with a live activity channel. |
| `antigravity_session_prompt` | Sends a prompt with a default `20s` live observation window (`waitMs`). Returns `[RUNNING]`, `stateDetail`, recent steps, and `cursor` if still working. |
| `antigravity_session_watch` | Reads the open live channel from `cursor` and returns new steps (`thought`, `message`, `tool_start`, `tool_done`, `question`, `subagent`) in real time. |
| `antigravity_session_interrupt` | Interrupts an active turn without destroying the session (reconnects via `--conversation`) and optionally runs a `steerPrompt` immediately. |
| `antigravity_session_list` | Lists active sessions, state (`idle`/`running`), active model, `stateDetail`, and `cursor`. |
| `antigravity_session_close` | Closes and releases a persistent session. |
| `antigravity_run` | Runs a single isolated turn (returning an activity summary and final response) and closes the session automatically. |

### Key Parameters
- `mode`:
  - `"plan"`: Read-only inspection and architectural analysis (no file edits).
  - `"auto"`: Automatically approves file edits and safe workspace commands while reviewing external actions.
  - `"accept-edits"`: Full write and terminal execution authorization for code changes, git branches, and tests.
- `waitMs`: Live observation window in milliseconds (default `20000`). If the turn is still running when `waitMs` elapses, returns a compact live update (`[RUNNING]`, `stateDetail`, recent steps, `cursor`) without stopping `agy`.
- `verbose`: Set `true` for full JSON on status, create, prompt, watch, interrupt, list, and run.
- `compact`: Set `true` to prefix the turn with `/compact` and summarize conversation history before executing the prompt.
- `effort`: `"low" | "medium" | "high" | "xhigh" | "max"`.
- `skipPermissions`: `true` (default) for autonomous non-blocking execution inside the workspace.
- `subagents`: `"auto"` (default), `"required"`, or `"off"`.
- `model`: Optional model ID in `agy 1.4.0` (e.g., `gemini-4-argon-medium`, `gemini-4-argon-high`, `gemini-3.8-flash-high`, `gemini-3.8-flash-medium`, `claude-sonnet-5-5-high`, `claude-opus-5-5-high`, `gpt-oss-120b-medium`).
- `conversationId`: Optional conversation ID to resume a prior conversation (`--conversation`).

---

## 💡 Usage Examples in Codex

### 1. Check Status and Available Models
```text
@Codex Antigravity run antigravity_status and list the available models.
```

### 2. Full Feature Implementation with Live Channel Supervision (`accept-edits`)
```text
@Codex Antigravity in /Users/user/projects/my-app:
Create a persistent session in mode "accept-edits".
1. Create a git branch 'feature/live-channel'.
2. Implement the requested code changes.
3. Run the test suite and report live progress as Antigravity works.
```

### 3. Architectural Audit (`plan`)
```text
@Codex Antigravity in /Users/user/projects/my-app:
Create a session in mode "plan".
Audit the repository architecture, identify bottlenecks, and return a structured improvement plan without modifying files.
```

---

## 🧪 Automated Tests & Validation

```sh
npm test
npm run validate:plugin
```

---

## 🔄 Refreshing the Plugin in Codex

If you update the repository and want to refresh Codex's marketplace cache from scratch:

```bash
CODEX=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
REPO=/Users/fitzgeraldbendezu/projects/codex-antigravity-mcp

"$CODEX" plugin remove codex-antigravity@codex-antigravity-marketplace
"$CODEX" plugin marketplace remove codex-antigravity-marketplace
git -C "$REPO" fetch --tags origin
git -C "$REPO" checkout main
git -C "$REPO" pull --ff-only origin main
"$CODEX" plugin marketplace add https://github.com/Lucemz/codex-antigravity-mcp --ref main
"$CODEX" plugin add codex-antigravity@codex-antigravity-marketplace
```

---

## 📄 License

Released under the [MIT License](LICENSE).
