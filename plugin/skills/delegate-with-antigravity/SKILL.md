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
   - Always keep the user in the loop with real-time progress instead of blocking silently for minutes:
   - `antigravity_session_prompt` uses a **20-second live observation window by default** (`waitMs: 20000`).
   - If the turn finishes within `waitMs`, you immediately receive `status: "SUCCESS"`, `timeline`, `workspaceActivity` (`filesRead`, `filesModified`, `commandsRun`), `cumulativeUsage`, and the final `response`.
   - If Antigravity is still actively working when `waitMs` elapses, the tool returns **`status: "RUNNING"`** (without interrupting Antigravity) along with:
     - `currentStep`: the exact action currently in progress (e.g., `"🧠 Thinking: ..."`, `"🔧 run_command: npm test"`, `"💬 Inspecting tsconfig.json..."`).
     - `timeline` / `events`: every thought, intermediate message, file read/edit (`view_file`, `replace_file_content`), command executed (`run_command`), question (`ask_question`), and subagent spawned so far.
     - `workspaceActivity`: `{ filesRead, filesModified, commandsRun, mediaGenerated }`.
     - `nextCursor`: the event cursor position.
   - **While `status === "RUNNING"`**:
     1. Briefly narrate the new steps from `timeline` / `currentStep` / `workspaceActivity` to the user so they can see what Antigravity just discovered or executed.
     2. Immediately call `antigravity_session_watch({ sessionId, cursor: nextCursor, waitMs: 15000, returnOnStep: true })` to receive the next live events as they happen, repeating until `status: "SUCCESS"` (or `"ERROR"` / `"TIMEOUT"`).

3. **Photo, Image, Screenshot & Video Generation**:
   - Antigravity can generate images/photos/icons via its built-in `image-generator` subagent (`generate_image`), capture browser screenshots and WebM recordings (`capture_browser_screenshot`, `browser_subagent`, `webm_encoder`), and convert/process video or images using `ffmpeg` and `sips`.
   - All generated media paths (both inside `~/.gemini/antigravity-cli/brain/<conversation_id>/` and any copies placed in the workspace) are automatically tracked in `workspaceActivity.mediaGenerated`.

4. **Hot Interrupt, Steering & Context Compaction (`antigravity_session_interrupt` & `compact`)**:
   - If you observe via the live channel that Antigravity is taking a wrong approach or the user changes requirements mid-flight, call `antigravity_session_interrupt({ sessionId, reason, steerPrompt })`. It cleanly stops the active turn, reconnects to the same `conversationId`, and immediately runs `steerPrompt`.
   - In long multi-turn sessions where `cumulativeUsage.totalTokens` grows large, pass `compact: true` to `antigravity_session_prompt` so Antigravity runs `/compact` before executing the prompt.

5. **Supervise and Verify**:
   - Inspect the returned structured payload (`timeline`, `workspaceActivity`, `tools`, `subagents`, `response`, `errorCode`, and `diagnostics`).
   - If `errorCode === "QUOTA_EXCEEDED"`, create a new session with an alternative model (such as `gemini-3.8-flash-medium` or `gpt-oss-120b-medium`) and pass `conversationId` to continue seamlessly.

6. **Finalize (`antigravity_session_close`)**:
   - Close the session (`antigravity_session_close`) once the workflow is completed.
   - Present the final structured outcome (files changed, generated media paths, git branch status, test execution results, and summary) to the user.
