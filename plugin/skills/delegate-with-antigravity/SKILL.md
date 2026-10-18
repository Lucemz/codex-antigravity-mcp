---
name: delegate-with-antigravity
description: Use Codex Antigravity when the codex-antigravity plugin is explicitly selected or when Antigravity analysis, planning, implementation, or validation is requested.
metadata:
  short-description: Delegate work to Antigravity
---

# Delegate with Codex Antigravity (Live Channel Supervision)

When the `codex-antigravity` plugin is explicitly selected or tagged, Codex acts as the **Supervisor Agent** and delegates execution to Antigravity (`agy`) as an **Autonomous Coding Subagent** over an open, real-time activity channel. The user's tag authorizes full inspection, programming, and terminal command execution inside the declared workspace.

### Live Supervised Development Workflow

1. **Initialize Session (`antigravity_session_create`)**:
   - For code implementation, feature development, bug fixing, refactoring, and git operations (switching branches, creating commits, running builds): start the session with `mode: "accept-edits"` (or `mode: "auto"`), `cwd: <workspace>`, and `skipPermissions: true`.
   - For read-only architectural analysis, audits, and exploration: use `mode: "plan"`.
   - Optional parameters: `effort: "low" | "medium" | "high" | "xhigh" | "max"`, `addDirs` for multi-repository workspaces, or `conversationId` to resume a previous conversation.

2. **Delegate & Stream Live Activity (`antigravity_session_prompt` + `antigravity_session_watch`)**:
   - Always keep the user in the loop with real-time progress without bloating your context window:
   - `antigravity_session_prompt` uses a **20-second live observation window by default** (`waitMs: 20000`).
   - **While `[RUNNING]`**: the tool returns a compact native-subagent ticker (only a few lines) containing:
     - `stateDetail`: the exact action currently in progress (e.g., `"🧠 Thinking: ..."`, `"🔧 run_command: npm test"`, `"💬 Inspecting tsconfig.json..."`).
     - `steps`: at most eight recent new steps since the last `cursor`, with one-line previews capped at 300 characters. Omitted steps are counted; use `verbose: true` with the same input cursor to inspect buffered events before advancing the cursor.
     - `cursor`: the next cursor integer to pass to `antigravity_session_watch`.
   - **While `[RUNNING]` loop**:
     1. Briefly narrate the new `steps` / `stateDetail` to the user so they see what Antigravity is doing right now.
     2. Immediately call `antigravity_session_watch({ sessionId, cursor, waitMs: 15000, returnOnStep: true })` until `[SUCCESS]` (or `[ERROR]` / `[TIMEOUT]`).
   - **When `[SUCCESS]`**: the tool returns a clean `activity:` summary (`read`, `modified`, `commands`, `media`, `subagents`, and recent `steps`) followed by `---` and Antigravity's final Markdown response. (Pass `verbose: true` only if you ever need the raw JSON object).

3. **Photo, Image, Screenshot & Video Generation**:
   - Antigravity can generate images/photos/icons via its built-in `image-generator` subagent (`generate_image`), capture browser screenshots and WebM recordings (`capture_browser_screenshot`, `browser_subagent`, `webm_encoder`), and convert/process video or images using `ffmpeg` and `sips`.
   - All generated media paths (both inside `~/.gemini/antigravity-cli/brain/<conversation_id>/` and any copies placed in the workspace) are automatically listed under `activity: media:`.

4. **Hot Interrupt, Steering & Context Compaction (`antigravity_session_interrupt` & `compact`)**:
   - If you observe via the live channel that Antigravity is taking a wrong approach or the user changes requirements mid-flight, call `antigravity_session_interrupt({ sessionId, reason, steerPrompt })`. It cleanly stops the active turn, reconnects to the same `conversationId`, and immediately runs `steerPrompt`.
   - In long multi-turn sessions, pass `compact: true` to `antigravity_session_prompt` so Antigravity runs `/compact` before executing the prompt.

5. **Supervise and Verify**:
   - Inspect the returned `activity:` summary (`read`, `modified`, `commands`, `media`, `subagents`) and final response.
   - If `error: [QUOTA_EXCEEDED]` is returned, create a new session with an alternative model (such as `gemini-3.8-flash-medium` or `gpt-oss-120b-medium`) and pass `conversationId` to continue seamlessly.

6. **Finalize (`antigravity_session_close`)**:
   - Close the session (`antigravity_session_close`) once the workflow is completed.
   - Present the final structured outcome (files changed, generated media paths, git branch status, test execution results, and summary) to the user.
