export type ExecutionMode = "plan" | "accept-edits";
export type SubagentStrategy = "auto" | "required" | "off";

export interface SessionOptions {
  cwd: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  agent?: string;
  mode: ExecutionMode;
  sandbox: boolean;
  skipPermissions?: boolean;
}

export interface AgyResult {
  conversationId?: string;
  status: string;
  response: string;
  error?: string;
  diagnostics?: string;
  durationSeconds?: number;
  numTurns?: number;
  usage?: Record<string, unknown>;
  tools: string[];
  subagents: Array<Record<string, unknown>>;
  recoveryAttempted?: boolean;
}

export interface SessionSummary {
  sessionId: string;
  conversationId?: string;
  cwd: string;
  mode: ExecutionMode;
  sandbox: boolean;
  skipPermissions: boolean;
  state: "starting" | "idle" | "running" | "closed" | "failed";
  createdAt: string;
  lastActivityAt: string;
  queuedTurns: number;
}
