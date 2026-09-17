import { SessionManager } from "./session-manager.js";
import { AgyResult, ExecutionMode, SubagentStrategy } from "./types.js";

export function withSubagentGuidance(prompt: string, strategy: SubagentStrategy = "auto", mode: ExecutionMode = "plan"): string {
  const modeInstruction = mode === "accept-edits"
    ? "You have full write and terminal execution authorization in this workspace. Implement requested code changes directly (create/modify files, manage git branches, run build and test suites, and verify results)."
    : "You are in plan mode for inspection and analysis. Explore files, run read-only validation commands, and produce a structured plan without modifying files.";

  const workspaceInstruction = [
    "You are acting as an autonomous expert coding subagent operating inside the active workspace.",
    "Inspect relevant files, run necessary commands directly, and do not refuse execution assuming lack of permissions.",
    "Do not access or modify paths outside the designated workspace.",
    "Multi-repo / Monorepo awareness: If the workspace contains multiple repositories or sub-projects (e.g., subdirectories with their own .git or package.json), detect and execute git commands and test scripts inside the relevant sub-project directory (e.g. using `git -C <sub-folder>` or running commands in that sub-folder) rather than assuming root is a single repository.",
    modeInstruction,
    "Provide a structured, comprehensive response detailing findings, modified files, git status/diffs, test execution outputs, and verification status."
  ].join(" ");

  if (strategy === "off") return `${workspaceInstruction}\n\nUser task:\n${prompt}`;
  const instruction = strategy === "required"
    ? "Decompose the task and use native Antigravity subagents (invoke_subagent / research) for independent or concurrent parts of this task. If subagents are unavailable, state this clearly and proceed autonomously."
    : "Consider delegating independent or specialized sub-tasks to native Antigravity subagents (invoke_subagent / research) when it improves depth or speed. Proceed directly if the task is self-contained.";
  return `${workspaceInstruction}\n\n${instruction}\n\nUser task:\n${prompt}`;
}

export async function promptWithRecovery(
  manager: Pick<SessionManager, "get">,
  sessionId: string,
  prompt: string,
  strategy: SubagentStrategy | undefined,
  timeoutMs: number
): Promise<AgyResult> {
  const session = manager.get(sessionId);
  const mode = session.options?.mode ?? "plan";
  const first = await session.prompt(withSubagentGuidance(prompt, strategy, mode), timeoutMs);
  if (first.status !== "SUCCESS" || first.response.trim()) return first;
  const recovered = await session.prompt(
    "Your previous turn completed without report text. Return the complete answer to the prior user task now as plain text. Do not start new work or call tools.",
    timeoutMs
  );
  if (!recovered.response.trim() && !recovered.error) {
    recovered.error = "Antigravity completed without emitting report text after an automatic recovery turn.";
  }
  recovered.recoveryAttempted = true;
  return recovered;
}
