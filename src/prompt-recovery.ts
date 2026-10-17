import { SessionManager } from "./session-manager.js";
import { AgyResult, ExecutionMode, SubagentStrategy } from "./types.js";

export function withSubagentGuidance(
  prompt: string,
  strategy: SubagentStrategy = "auto",
  mode: ExecutionMode = "plan",
  compact = false
): string {
  const modeInstruction = mode === "accept-edits"
    ? "You have full write and terminal execution authorization in this workspace. Implement requested code changes directly (create/modify files, manage git branches, run build and test suites, and verify results)."
    : mode === "auto"
      ? "You are in auto mode: file edits and safe workspace commands are approved automatically, while actions outside the workspace sandbox are reviewed. Implement and verify changes directly."
      : "You are in plan mode for inspection and analysis. Explore files, run read-only validation commands, and produce a structured plan in your text response without modifying files.";

  const workspaceInstruction = [
    "You are acting as an autonomous expert coding subagent operating inside the active workspace.",
    "Inspect relevant files, run necessary commands directly, and do not refuse execution assuming lack of permissions.",
    "Keep code modifications inside the designated workspace, except when reading or copying generated media and artifacts from Antigravity's brain directories (~/.gemini/antigravity-cli/brain or ~/.gemini/antigravity/brain) or temporary directories.",
    "Media, Photo, Image & Video Generation: When asked to generate photos, icons, illustrations, or UI images, invoke the built-in `image-generator` subagent (or `generate_image` tool). For browser screenshots or WebM video recordings, use `capture_browser_screenshot` or `browser_subagent`, and use `ffmpeg`, `webm_encoder`, or `sips` for video/image conversion or processing when needed. If the user asks for media to be saved inside the workspace, copy the generated file from the brain directory into the target workspace path and always include the exact absolute file path(s) in your response.",
    "Non-blocking execution requirement: Never call `ask_question` and never create artifacts with `RequestFeedback: true` that block waiting for interactive user approval. Return all plans, findings, and questions directly in your text response to the supervisor agent.",
    "Multi-repo / Monorepo awareness: If the workspace contains multiple repositories or sub-projects (e.g., subdirectories with their own .git or package.json), detect and execute git commands and test scripts inside the relevant sub-project directory (e.g. using `git -C <sub-folder>` or running commands in that sub-folder) rather than assuming root is a single repository.",
    "Emit brief, clear progress updates as you inspect files, make edits, or run commands so the supervisor agent monitoring your live stream always knows your current action.",
    modeInstruction,
    "Provide a structured, comprehensive response detailing findings, modified files, generated media paths, git status/diffs, test execution outputs, and verification status."
  ].join(" ");

  const prefix = compact ? "/compact " : "";

  if (strategy === "off") return `${prefix}${workspaceInstruction}\n\nUser task:\n${prompt}`;
  const instruction = strategy === "required"
    ? "Decompose the task and use native Antigravity subagents (invoke_subagent / research, using isolated Workspace='branch' or 'share' when parallel edits are needed) for independent or concurrent parts of this task. If subagents are unavailable, state this clearly and proceed autonomously."
    : "Consider delegating independent or specialized sub-tasks to native Antigravity subagents (invoke_subagent / research, or Workspace='branch'/'share' for isolated parallel work) when it improves depth or speed. Proceed directly if the task is self-contained.";
  return `${prefix}${workspaceInstruction}\n\n${instruction}\n\nUser task:\n${prompt}`;
}

export async function promptWithRecovery(
  manager: Pick<SessionManager, "get">,
  sessionId: string,
  prompt: string,
  strategy: SubagentStrategy | undefined,
  timeoutMs: number,
  waitMs?: number,
  compact = false
): Promise<AgyResult> {
  const session = manager.get(sessionId) as {
    options?: { mode?: ExecutionMode };
    prompt: (prompt: string, timeoutMs: number) => Promise<AgyResult>;
    promptWindow?: (prompt: string, timeoutMs: number, waitMs?: number) => Promise<AgyResult>;
  };
  const mode = session.options?.mode ?? "plan";
  const guided = withSubagentGuidance(prompt, strategy, mode, compact);
  const first = session.promptWindow && waitMs
    ? await session.promptWindow(guided, timeoutMs, waitMs)
    : await session.prompt(guided, timeoutMs);
  if (first.status === "RUNNING" || first.status !== "SUCCESS" || first.response.trim()) return first;
  const recoveryPrompt = "Your previous turn completed without report text. Return the complete answer to the prior user task now as plain text. Do not start new work or call tools.";
  const recovered = session.promptWindow && waitMs
    ? await session.promptWindow(recoveryPrompt, timeoutMs, waitMs)
    : await session.prompt(recoveryPrompt, timeoutMs);
  if (recovered.status !== "RUNNING" && !recovered.response.trim() && !recovered.error) {
    recovered.error = "Antigravity completed without emitting report text after an automatic recovery turn.";
  }
  recovered.recoveryAttempted = true;
  return recovered;
}
