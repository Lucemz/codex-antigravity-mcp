export type ExecutionMode = "plan" | "auto" | "accept-edits";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type SubagentStrategy = "auto" | "required" | "off";
export type AgyErrorCode = "QUOTA_EXCEEDED" | "AUTH_EXPIRED" | "TIMEOUT" | "INTERRUPTED" | "EXECUTION_ERROR";

export interface SessionOptions {
  cwd: string;
  addDirs?: string[];
  model?: string;
  effort?: ReasoningEffort;
  agent?: string;
  mode: ExecutionMode;
  sandbox: boolean;
  skipPermissions?: boolean;
  conversationId?: string;
}

export interface ActivityEvent {
  seq: number;
  timestamp: string;
  type: "init" | "thought" | "message" | "tool_start" | "tool_done" | "question" | "subagent" | "interrupt" | "result" | "error";
  stepIndex?: number;
  state?: string;
  toolName?: string;
  target?: string;
  outputPreview?: string;
  text?: string;
  durationSeconds?: number;
  summary: string;
}

export interface CommandSummary {
  command: string;
  outputPreview?: string;
  durationSeconds?: number;
  state: "ACTIVE" | "DONE";
}

export interface WorkspaceActivity {
  filesRead: string[];
  filesModified: string[];
  commandsRun: CommandSummary[];
  mediaGenerated: string[];
}

export interface CumulativeUsage {
  turnsCompleted: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

export interface WatchOptions {
  cursor?: number;
  waitMs?: number;
  returnOnStep?: boolean;
}

export interface AgyResult {
  conversationId?: string;
  status: string;
  response: string;
  error?: string;
  errorCode?: AgyErrorCode;
  diagnostics?: string;
  durationSeconds?: number;
  numTurns?: number;
  usage?: Record<string, unknown>;
  cumulativeUsage?: CumulativeUsage;
  tools: string[];
  subagents: Array<Record<string, unknown>>;
  recoveryAttempted?: boolean;
  activeModel?: string;
  permissionMode?: string;
  currentStep?: string;
  workspaceActivity?: WorkspaceActivity;
  events?: ActivityEvent[];
  nextCursor?: number;
}

export interface SessionSummary {
  sessionId: string;
  conversationId?: string;
  cwd: string;
  mode: ExecutionMode;
  sandbox: boolean;
  skipPermissions: boolean;
  state: "starting" | "idle" | "running" | "closed" | "failed";
  activeModel?: string;
  permissionMode?: string;
  currentStep?: string;
  workspaceActivity?: WorkspaceActivity;
  cumulativeUsage: CumulativeUsage;
  lastCursor: number;
  createdAt: string;
  lastActivityAt: string;
  queuedTurns: number;
}
