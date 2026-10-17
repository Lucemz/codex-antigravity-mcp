import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { buildSpawnEnv } from "./agy-discovery.js";
import {
  ActivityEvent,
  AgyErrorCode,
  AgyResult,
  CommandSummary,
  CumulativeUsage,
  SessionOptions,
  SessionSummary,
  WatchOptions,
  WorkspaceActivity
} from "./types.js";

const MAX_DIAGNOSTIC_CHARS = 8_000;
const MAX_EVENTS_BUFFER = 500;

const READ_TOOLS = new Set(["view_file", "grep_search", "find_by_name", "list_dir"]);
const WRITE_TOOLS = new Set([
  "replace_file_content",
  "multi_replace_file_content",
  "write_to_file",
  "sed_file",
  "notebook_edit"
]);
const MEDIA_TOOLS = new Set(["generate_image", "capture_browser_screenshot", "browser_subagent"]);
const MEDIA_EXT_REGEX = /\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|m4a|pdf)$/i;
const MEDIA_PATH_SCAN_REGEX = /(?:file:\/\/)?(\/[^\s"'`<>()[\]]+\.(?:png|jpe?g|webp|gif|svg|mp4|webm|mov|mp3|wav|m4a|pdf))/gi;

interface PendingTurn {
  prompt: string;
  timeoutMs: number;
  startCursor: number;
  resolve: (result: AgyResult) => void;
  reject: (error: Error) => void;
}

export function classifyError(errorText?: string, diagnostics?: string): AgyErrorCode {
  const combined = `${errorText ?? ""}\n${diagnostics ?? ""}`;
  if (/authentication expired|please log back in|not authenticated|unauthorized/i.test(combined)) {
    return "AUTH_EXPIRED";
  }
  if (/credits balance is too low|quota|rate.?limit|resource_exhausted|capacity/i.test(combined)) {
    return "QUOTA_EXCEEDED";
  }
  return "EXECUTION_ERROR";
}

export function extractMediaPaths(text?: unknown): string[] {
  if (typeof text !== "string" || !text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(MEDIA_PATH_SCAN_REGEX)) {
    const candidate = match[1]?.replace(/[.,;:]+$/, "");
    if (candidate && MEDIA_EXT_REGEX.test(candidate)) {
      found.add(candidate);
    }
  }
  return [...found];
}

function extractToolTarget(params?: Record<string, unknown>, subagents?: unknown): string | undefined {
  if (Array.isArray(subagents) && subagents.length > 0) {
    const labels = subagents
      .map((s: any) => {
        if (!s || typeof s !== "object") return undefined;
        const role = s.role || s.Role;
        const typeName = s.type_name || s.type || s.TypeName;
        if (role && typeName && role.toLowerCase() !== typeName.toLowerCase()) {
          return `${role} (${typeName})`;
        }
        return role || typeName;
      })
      .filter(Boolean)
      .join(", ");
    if (labels) return labels.slice(0, 180);
  }
  if (!params || typeof params !== "object") return undefined;
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    const q = params.questions[0] as Record<string, unknown> | undefined;
    if (q && typeof q.question === "string" && q.question.trim()) {
      return q.question.trim().replace(/\s+/g, " ").slice(0, 200);
    }
  }
  const candidateKeys = [
    "AbsolutePath",
    "TargetFile",
    "FilePath",
    "ImageName",
    "DirectoryPath",
    "SearchPath",
    "path",
    "CommandLine",
    "command",
    "Prompt",
    "Query",
    "query",
    "Pattern",
    "Url",
    "question",
    "reason",
    "Recipient",
    "TaskId"
  ];
  for (const key of candidateKeys) {
    const val = params[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim().replace(/\s+/g, " ").slice(0, 180);
    }
  }
  if (Array.isArray(params.Subagents)) {
    const roles = params.Subagents
      .map((s: any) => (s && typeof s === "object" ? s.Role || s.TypeName : undefined))
      .filter(Boolean)
      .join(", ");
    if (roles) return roles.slice(0, 180);
  }
  return undefined;
}

function cleanPreview(value: unknown, maxLen = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

export class AgySession {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  private child!: ChildProcessWithoutNullStreams;
  private readonly queue: PendingTurn[] = [];
  private active?: PendingTurn;
  private inactivityTimer?: NodeJS.Timeout;
  private hardCeilingTimer?: NodeJS.Timeout;
  private currentInactivityMs = 600_000;
  private diagnostics = "";
  private lastActivity = new Date();
  private state: SessionSummary["state"] = "starting";
  private conversationId?: string;
  private activeModel?: string;
  private permissionMode?: string;
  private currentStep?: string;
  private eventSeq = 0;
  private readonly events: ActivityEvent[] = [];
  private readonly eventListeners = new Set<(event: ActivityEvent) => void>();
  private readonly turnFinishListeners = new Set<(result: AgyResult) => void>();
  private turnTools = new Set<string>();
  private turnSubagents: Array<Record<string, unknown>> = [];
  private turnText = "";
  private stepTextByIndex = new Map<number, string>();
  private stepThoughtByIndex = new Map<number, string>();
  private emittedMessageSteps = new Set<number>();
  private emittedThoughtSteps = new Set<number>();
  private filesRead = new Set<string>();
  private filesModified = new Set<string>();
  private commandsRun = new Map<string, CommandSummary>();
  private mediaGenerated = new Set<string>();
  private cumulativeUsage: CumulativeUsage = {
    turnsCompleted: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0
  };
  private lastTurnResult?: AgyResult;
  private intentionallyRespawning = false;

  constructor(private readonly binary: string, readonly options: SessionOptions, private readonly onTerminal: () => void) {
    this.conversationId = options.conversationId;
    this.spawnChild(this.conversationId);
  }

  private spawnChild(resumeConversationId?: string): void {
    const args = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--mode",
      this.options.mode,
      "--add-dir",
      this.options.cwd
    ];
    if (this.options.addDirs?.length) {
      for (const dir of this.options.addDirs) {
        args.push("--add-dir", dir);
      }
    }
    if (this.options.skipPermissions) args.push("--dangerously-skip-permissions");
    if (this.options.sandbox) args.push("--sandbox");
    if (this.options.model) args.push("--model", this.options.model);
    if (this.options.effort) args.push("--effort", this.options.effort);
    if (this.options.agent) args.push("--agent", this.options.agent);
    if (resumeConversationId) args.push("--conversation", resumeConversationId);

    const spawned = spawn(this.binary, args, {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildSpawnEnv(process.env)
    });
    this.child = spawned;
    spawned.stderr.setEncoding("utf8");
    spawned.stderr.on("data", (chunk) => {
      if (this.child !== spawned) return;
      this.appendDiagnostic(chunk);
      this.refreshInactivityTimer();
    });
    createInterface({ input: spawned.stdout }).on("line", (line) => {
      if (this.child !== spawned) return;
      this.handleLine(line);
    });
    spawned.once("error", (error) => {
      if (this.child !== spawned) return;
      this.fail(error);
    });
    spawned.once("close", (code, signal) => {
      if (this.child !== spawned || this.intentionallyRespawning) return;
      if (this.state !== "closed") {
        this.fail(new Error(`agy session exited (${code ?? "null"}, ${signal ?? "no signal"}). ${this.diagnostics}`));
      }
      this.onTerminal();
    });
  }

  get isClosed(): boolean {
    return this.state === "closed" || this.state === "failed";
  }

  onEvent(listener: (event: ActivityEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  getCursor(): number {
    return this.eventSeq;
  }

  eventsSince(cursor = 0): ActivityEvent[] {
    return this.events.filter((e) => e.seq > cursor);
  }

  private scanBrainMedia(): void {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return;
    const convIds = new Set<string>();
    if (this.conversationId) convIds.add(this.conversationId);
    for (const sub of this.turnSubagents) {
      const subId = typeof sub.conversation_id === "string"
        ? sub.conversation_id
        : typeof sub.conversationId === "string"
          ? sub.conversationId
          : undefined;
      if (subId) convIds.add(subId);
    }
    for (const id of convIds) {
      for (const root of [".gemini/antigravity-cli/brain", ".gemini/antigravity/brain"]) {
        const brainDir = join(home, root, id);
        try {
          if (!existsSync(brainDir)) continue;
          for (const entry of readdirSync(brainDir)) {
            if (MEDIA_EXT_REGEX.test(entry)) {
              this.mediaGenerated.add(join(brainDir, entry));
            }
          }
        } catch {
          // Ignore unreadable brain directories
        }
      }
    }
  }

  getWorkspaceActivity(): WorkspaceActivity {
    this.scanBrainMedia();
    return {
      filesRead: [...this.filesRead],
      filesModified: [...this.filesModified],
      commandsRun: [...this.commandsRun.values()],
      mediaGenerated: [...this.mediaGenerated]
    };
  }

  getCumulativeUsage(): CumulativeUsage {
    return { ...this.cumulativeUsage };
  }

  prompt(prompt: string, timeoutMs: number): Promise<AgyResult> {
    if (this.state === "closed") return Promise.reject(new Error("Session is closed."));
    if (this.state === "failed" && this.conversationId) {
      this.state = "idle";
      this.spawnChild(this.conversationId);
    } else if (this.state === "failed") {
      return Promise.reject(new Error("Session is closed."));
    }
    const startCursor = this.eventSeq;
    return new Promise<AgyResult>((resolvePrompt, rejectPrompt) => {
      this.queue.push({ prompt, timeoutMs, startCursor, resolve: resolvePrompt, reject: rejectPrompt });
      this.advance();
    });
  }

  async promptWindow(prompt: string, timeoutMs: number, waitMs?: number): Promise<AgyResult> {
    const startCursor = this.eventSeq;
    const turnPromise = this.prompt(prompt, timeoutMs);
    turnPromise.catch(() => {});

    if (!waitMs || waitMs >= timeoutMs) {
      return await turnPromise;
    }

    return await new Promise<AgyResult>((resolveWindow) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolveWindow(this.snapshotResult("RUNNING", startCursor));
      }, waitMs);

      turnPromise.then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolveWindow(result);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const errMessage = error instanceof Error ? error.message : String(error);
          resolveWindow({
            conversationId: this.conversationId,
            status: "ERROR",
            response: this.turnText,
            error: errMessage,
            errorCode: classifyError(errMessage, this.diagnostics),
            diagnostics: this.diagnostics || undefined,
            cumulativeUsage: this.getCumulativeUsage(),
            tools: [...this.turnTools],
            subagents: this.turnSubagents,
            activeModel: this.activeModel ?? this.options.model,
            permissionMode: this.permissionMode,
            currentStep: this.currentStep,
            workspaceActivity: this.getWorkspaceActivity(),
            events: this.eventsSince(startCursor),
            nextCursor: this.eventSeq
          });
        }
      );
    });
  }

  async interrupt(reason = "Turn interrupted by supervisor."): Promise<AgyResult> {
    if (this.isClosed) throw new Error("Session is closed.");
    const interrupted = this.active;
    const startCursor = interrupted ? interrupted.startCursor : this.eventSeq;
    this.active = undefined;
    this.clearTimers();
    this.currentStep = `🛑 Interrupted: ${reason}`;
    this.recordEvent({ type: "interrupt", summary: this.currentStep });

    const partialResponse = this.turnText.trim()
      ? `[${reason} Partial output:]\n\n${this.turnText}`
      : reason;

    const result: AgyResult = {
      conversationId: this.conversationId,
      status: "INTERRUPTED",
      response: partialResponse,
      error: reason,
      errorCode: "INTERRUPTED",
      cumulativeUsage: this.getCumulativeUsage(),
      tools: [...this.turnTools],
      subagents: [...this.turnSubagents],
      activeModel: this.activeModel ?? this.options.model,
      permissionMode: this.permissionMode,
      currentStep: this.currentStep,
      workspaceActivity: this.getWorkspaceActivity(),
      events: this.eventsSince(startCursor),
      nextCursor: this.eventSeq
    };

    this.lastTurnResult = result;
    for (const listener of this.turnFinishListeners) {
      try {
        listener(result);
      } catch {
        /* ignore */
      }
    }
    interrupted?.resolve(result);

    const oldChild = this.child;
    this.intentionallyRespawning = true;
    try {
      oldChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.state = "idle";
    this.spawnChild(this.conversationId);
    this.intentionallyRespawning = false;
    this.advance();
    return result;
  }

  async watch(options: WatchOptions = {}): Promise<AgyResult> {
    const cursor = options.cursor ?? 0;
    const waitMs = options.waitMs ?? 15_000;
    const returnOnStep = options.returnOnStep ?? true;

    if (!this.active) {
      if (this.lastTurnResult) {
        return {
          ...this.lastTurnResult,
          activeModel: this.activeModel ?? this.lastTurnResult.activeModel,
          permissionMode: this.permissionMode ?? this.lastTurnResult.permissionMode,
          currentStep: this.currentStep,
          cumulativeUsage: this.getCumulativeUsage(),
          workspaceActivity: this.getWorkspaceActivity(),
          events: this.eventsSince(cursor),
          nextCursor: this.eventSeq
        };
      }
      return this.snapshotResult(this.state === "failed" ? "ERROR" : "IDLE", cursor);
    }

    if (waitMs <= 0) {
      return this.snapshotResult("RUNNING", cursor);
    }

    if (returnOnStep && this.eventSeq > cursor) {
      await new Promise((r) => setTimeout(r, 150));
      if (!this.active && this.lastTurnResult) {
        return {
          ...this.lastTurnResult,
          cumulativeUsage: this.getCumulativeUsage(),
          workspaceActivity: this.getWorkspaceActivity(),
          events: this.eventsSince(cursor),
          nextCursor: this.eventSeq
        };
      }
      return this.snapshotResult("RUNNING", cursor);
    }

    return await new Promise<AgyResult>((resolveWatch) => {
      let settled = false;
      let coalesceTimer: NodeJS.Timeout | undefined;

      const finish = (result: AgyResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(windowTimer);
        if (coalesceTimer) clearTimeout(coalesceTimer);
        offEvent();
        this.turnFinishListeners.delete(onTurnDone);
        resolveWatch(result);
      };

      const onTurnDone = (finalResult: AgyResult) => {
        finish({
          ...finalResult,
          cumulativeUsage: this.getCumulativeUsage(),
          workspaceActivity: this.getWorkspaceActivity(),
          events: this.eventsSince(cursor),
          nextCursor: this.eventSeq
        });
      };

      const offEvent = this.onEvent((ev) => {
        if (!returnOnStep) return;
        if (
          ev.type === "thought" ||
          ev.type === "message" ||
          ev.type === "tool_start" ||
          ev.type === "tool_done" ||
          ev.type === "question" ||
          ev.type === "subagent"
        ) {
          if (!coalesceTimer) {
            coalesceTimer = setTimeout(() => {
              finish(this.snapshotResult("RUNNING", cursor));
            }, 250);
          }
        }
      });

      this.turnFinishListeners.add(onTurnDone);

      const windowTimer = setTimeout(() => {
        finish(this.snapshotResult("RUNNING", cursor));
      }, waitMs);
    });
  }

  summary(): SessionSummary {
    return {
      sessionId: this.id,
      conversationId: this.conversationId,
      cwd: this.options.cwd,
      mode: this.options.mode,
      sandbox: this.options.sandbox,
      skipPermissions: this.options.skipPermissions ?? true,
      state: this.state,
      activeModel: this.activeModel ?? this.options.model,
      permissionMode: this.permissionMode,
      currentStep: this.currentStep,
      workspaceActivity: this.getWorkspaceActivity(),
      cumulativeUsage: this.getCumulativeUsage(),
      lastCursor: this.eventSeq,
      createdAt: this.createdAt.toISOString(),
      lastActivityAt: this.lastActivity.toISOString(),
      queuedTurns: this.queue.length + (this.active ? 1 : 0)
    };
  }

  getDiagnostics(): string {
    return this.diagnostics;
  }

  async close(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closed";
    this.clearTimers();
    this.active?.reject(new Error("Session was closed."));
    this.active = undefined;
    while (this.queue.length) this.queue.shift()?.reject(new Error("Session was closed."));
    const currentChild = this.child;
    currentChild.stdin.end();
    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        currentChild.kill("SIGTERM");
        resolveClose();
      }, 5_000);
      currentChild.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }

  private snapshotResult(status: string, fromCursor: number): AgyResult {
    return {
      conversationId: this.conversationId,
      status,
      response: this.turnText,
      errorCode: status === "ERROR" ? classifyError(undefined, this.diagnostics) : undefined,
      diagnostics: status === "ERROR" ? (this.diagnostics || undefined) : undefined,
      cumulativeUsage: this.getCumulativeUsage(),
      tools: [...this.turnTools],
      subagents: [...this.turnSubagents],
      activeModel: this.activeModel ?? this.options.model,
      permissionMode: this.permissionMode,
      currentStep: this.currentStep,
      workspaceActivity: this.getWorkspaceActivity(),
      events: this.eventsSince(fromCursor),
      nextCursor: this.eventSeq
    };
  }

  private recordEvent(partial: Omit<ActivityEvent, "seq" | "timestamp">): ActivityEvent {
    const event: ActivityEvent = {
      seq: ++this.eventSeq,
      timestamp: new Date().toISOString(),
      ...partial
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS_BUFFER) {
      this.events.shift();
    }
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        /* ignore listener errors */
      }
    }
    return event;
  }

  private advance(): void {
    if (this.active || this.state === "closed" || this.state === "failed") return;
    const turn = this.queue.shift();
    if (!turn) {
      this.state = "idle";
      return;
    }
    this.active = turn;
    this.state = "running";
    this.lastActivity = new Date();
    this.turnTools = new Set();
    this.turnSubagents = [];
    this.turnText = "";
    this.stepTextByIndex.clear();
    this.stepThoughtByIndex.clear();
    this.emittedMessageSteps.clear();
    this.emittedThoughtSteps.clear();
    this.currentStep = "⏳ Waiting for initial steps from Antigravity...";
    this.currentInactivityMs = turn.timeoutMs;
    turn.startCursor = this.eventSeq;

    this.startInactivityTimer();

    this.hardCeilingTimer = setTimeout(() => {
      this.onTimeout("Turn exceeded maximum hard ceiling timeout (30m).");
    }, 1_800_000);

    this.child.stdin.write(`${JSON.stringify({ event: "user", message: { content: turn.prompt } })}\n`);
  }

  private startInactivityTimer(): void {
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.onTimeout(`Turn timed out after ${this.currentInactivityMs}ms of inactivity.`);
    }, this.currentInactivityMs);
  }

  private refreshInactivityTimer(): void {
    if (this.active && !this.isClosed) {
      this.lastActivity = new Date();
      this.startInactivityTimer();
    }
  }

  private clearTimers(): void {
    clearTimeout(this.inactivityTimer);
    clearTimeout(this.hardCeilingTimer);
    this.inactivityTimer = undefined;
    this.hardCeilingTimer = undefined;
  }

  private onTimeout(reason: string): void {
    const timedOut = this.active;
    if (!timedOut) return;
    this.active = undefined;
    this.clearTimers();
    this.currentStep = `⚠️ Timeout: ${reason}`;
    this.recordEvent({ type: "error", summary: this.currentStep });
    const partialResponse = this.turnText.trim()
      ? `[${reason} Partial output:]\n\n${this.turnText}`
      : reason;
    const finalResult: AgyResult = {
      conversationId: this.conversationId,
      status: "TIMEOUT",
      response: partialResponse,
      error: reason,
      errorCode: "TIMEOUT",
      diagnostics: this.diagnostics || undefined,
      cumulativeUsage: this.getCumulativeUsage(),
      tools: [...this.turnTools],
      subagents: this.turnSubagents,
      activeModel: this.activeModel ?? this.options.model,
      permissionMode: this.permissionMode,
      currentStep: this.currentStep,
      workspaceActivity: this.getWorkspaceActivity(),
      events: this.eventsSince(timedOut.startCursor),
      nextCursor: this.eventSeq
    };
    this.lastTurnResult = finalResult;
    for (const listener of this.turnFinishListeners) {
      try {
        listener(finalResult);
      } catch {
        /* ignore */
      }
    }
    timedOut.resolve(finalResult);
    this.child.kill("SIGTERM");
  }

  private accumulateUsage(usage?: Record<string, unknown>): void {
    this.cumulativeUsage.turnsCompleted += 1;
    if (!usage || typeof usage !== "object") return;
    if (typeof usage.input_tokens === "number") this.cumulativeUsage.inputTokens += usage.input_tokens;
    if (typeof usage.output_tokens === "number") this.cumulativeUsage.outputTokens += usage.output_tokens;
    if (typeof usage.thinking_tokens === "number") this.cumulativeUsage.thinkingTokens += usage.thinking_tokens;
    if (typeof usage.total_tokens === "number") this.cumulativeUsage.totalTokens += usage.total_tokens;
  }

  private handleLine(line: string): void {
    if (this.isClosed) return;
    this.refreshInactivityTimer();
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      this.appendDiagnostic(`Invalid NDJSON from agy: ${line}\n`);
      return;
    }
    if (!event || typeof event !== "object") return;
    if (event.event === "init") {
      this.conversationId = typeof event.conversation_id === "string" ? event.conversation_id : this.conversationId;
      if (event.init && typeof event.init === "object") {
        if (typeof event.init.model === "string") this.activeModel = event.init.model;
        if (typeof event.init.permission_mode === "string") this.permissionMode = event.init.permission_mode;
      }
      if (!this.active) this.state = "idle";
      this.recordEvent({
        type: "init",
        summary: `Session ready${this.activeModel ? ` (${this.activeModel})` : ""}${this.permissionMode ? ` [${this.permissionMode}]` : ""}`
      });
      return;
    }
    if (event.event === "step_update") {
      const step = event.step_update ?? {};
      const stepIndex = typeof step.step_index === "number" ? step.step_index : undefined;
      const stepState = typeof step.state === "string" ? step.state : undefined;
      const stepType = typeof step.step_type === "string" ? step.step_type : undefined;
      const durationSeconds = typeof step.duration_seconds === "number" ? step.duration_seconds : undefined;

      // 1. Capture reasoning / thinking_delta
      const thoughtDelta =
        typeof step.thinking_delta === "string"
          ? step.thinking_delta
          : typeof step.thought === "string"
            ? step.thought
            : undefined;
      if (thoughtDelta) {
        const key = stepIndex ?? -1;
        const prev = this.stepThoughtByIndex.get(key) ?? "";
        const updated = prev + thoughtDelta;
        this.stepThoughtByIndex.set(key, updated);
        const cleaned = updated.trim().replace(/\s+/g, " ");
        if (cleaned) {
          this.currentStep = `🧠 Thinking: ${cleaned.slice(-180)}`;
          if ((stepState === "DONE" || updated.length >= 120) && !this.emittedThoughtSteps.has(key)) {
            this.emittedThoughtSteps.add(key);
            this.recordEvent({
              type: "thought",
              stepIndex,
              state: stepState ?? "ACTIVE",
              text: cleaned,
              durationSeconds,
              summary: `🧠 ${cleaned.slice(0, 240)}`
            });
          }
        }
      }

      // 2. Capture tool execution & workspace activity
      if (typeof step.tool_name === "string") {
        const toolName = step.tool_name;
        this.turnTools.add(toolName);
        const target = extractToolTarget(step.tool_info?.parameters, step.subagent_info?.subagents);
        const rawOutput = step.tool_info?.output;
        const outputPreview = cleanPreview(rawOutput);

        if (target) {
          if (READ_TOOLS.has(toolName)) this.filesRead.add(target);
          if (WRITE_TOOLS.has(toolName)) {
            this.filesModified.add(target);
            if (MEDIA_EXT_REGEX.test(target)) this.mediaGenerated.add(target);
          }
          if (MEDIA_TOOLS.has(toolName) && MEDIA_EXT_REGEX.test(target)) {
            this.mediaGenerated.add(target);
          }
        }
        for (const mediaPath of extractMediaPaths(rawOutput)) {
          this.mediaGenerated.add(mediaPath);
        }
        if (toolName === "run_command" && target) {
          const cmdKey = `${this.active?.startCursor ?? this.eventSeq}:${stepIndex ?? target}`;
          this.commandsRun.set(cmdKey, {
            command: target,
            outputPreview,
            durationSeconds,
            state: stepState === "DONE" ? "DONE" : "ACTIVE"
          });
        }

        if (toolName === "ask_question" || toolName === "ask_permission" || toolName === "ask_custom_permission") {
          const summary = `❓ ${toolName}${target ? `: ${target}` : ""}`;
          this.currentStep = summary;
          this.recordEvent({
            type: "question",
            stepIndex,
            state: stepState ?? "ACTIVE",
            toolName,
            target,
            summary
          });
        } else if (stepState === "DONE") {
          const dur = durationSeconds !== undefined ? ` (${durationSeconds.toFixed(2)}s)` : "";
          const summary = `✔ ${toolName}${target ? `: ${target}` : ""}${outputPreview ? ` -> ${outputPreview}` : ""}${dur}`;
          this.currentStep = summary;
          this.recordEvent({
            type: "tool_done",
            stepIndex,
            state: stepState,
            toolName,
            target,
            outputPreview,
            durationSeconds,
            summary
          });
        } else {
          const summary = `🔧 ${toolName}${target ? `: ${target}` : ""}`;
          this.currentStep = summary;
          this.recordEvent({
            type: "tool_start",
            stepIndex,
            state: stepState ?? "ACTIVE",
            toolName,
            target,
            summary
          });
        }
      }

      // 3. Capture subagents (deduplicated across ACTIVE/DONE updates)
      if (Array.isArray(step.subagent_info?.subagents)) {
        for (const incoming of step.subagent_info.subagents) {
          if (!incoming || typeof incoming !== "object") continue;
          const incId = incoming.conversation_id || incoming.conversationId;
          const incRole = incoming.role || incoming.Role;
          const incType = incoming.type_name || incoming.type || incoming.TypeName;
          const existingIdx = this.turnSubagents.findIndex((s) => {
            const sId = s.conversation_id || s.conversationId;
            if (incId && sId) return incId === sId;
            const sRole = s.role || s.Role;
            const sType = s.type_name || s.type || s.TypeName;
            return !sId && sRole === incRole && sType === incType;
          });
          if (existingIdx >= 0) {
            this.turnSubagents[existingIdx] = { ...this.turnSubagents[existingIdx], ...incoming };
          } else {
            this.turnSubagents.push({ ...incoming });
          }
        }
        const roles = step.subagent_info.subagents
          .map((s: any) => {
            const role = s?.role || s?.Role;
            const typeName = s?.type_name || s?.type || s?.TypeName;
            const convId = s?.conversation_id || s?.conversationId;
            if (role && typeName && role.toLowerCase() !== typeName.toLowerCase()) {
              return `${role} (${typeName})`;
            }
            return role || typeName || convId || "subagent";
          })
          .join(", ");
        const summary = `🤖 Subagents: ${roles}`;
        this.currentStep = summary;
        if (stepState === "DONE" || typeof step.tool_name !== "string") {
          this.recordEvent({
            type: "subagent",
            stepIndex,
            state: stepState,
            summary
          });
        }
      }

      // 4. Capture agent narration / text_delta
      if (typeof step.text_delta === "string") {
        this.turnText += step.text_delta;
        if (stepIndex !== undefined) {
          const prev = this.stepTextByIndex.get(stepIndex) ?? "";
          const updated = prev + step.text_delta;
          this.stepTextByIndex.set(stepIndex, updated);
          const cleaned = updated.trim().replace(/\s+/g, " ");
          if (cleaned) {
            this.currentStep = `💬 ${cleaned.slice(-200)}`;
          }
          if (stepState === "DONE" && cleaned && !this.emittedMessageSteps.has(stepIndex)) {
            this.emittedMessageSteps.add(stepIndex);
            for (const mediaPath of extractMediaPaths(updated)) {
              this.mediaGenerated.add(mediaPath);
            }
            this.recordEvent({
              type: "message",
              stepIndex,
              state: "DONE",
              text: updated.trim(),
              durationSeconds,
              summary: `💬 ${cleaned.slice(0, 300)}`
            });
          }
        } else {
          const cleaned = step.text_delta.trim().replace(/\s+/g, " ");
          if (cleaned) {
            this.currentStep = `💬 ${cleaned.slice(0, 200)}`;
            for (const mediaPath of extractMediaPaths(step.text_delta)) {
              this.mediaGenerated.add(mediaPath);
            }
            this.recordEvent({
              type: "message",
              state: stepState ?? "DONE",
              text: step.text_delta.trim(),
              durationSeconds,
              summary: `💬 ${cleaned.slice(0, 300)}`
            });
          }
        }
      } else if (stepType === "agent_response" && stepState === "DONE" && stepIndex !== undefined) {
        const accumulated = this.stepTextByIndex.get(stepIndex)?.trim();
        if (accumulated && !this.emittedMessageSteps.has(stepIndex)) {
          this.emittedMessageSteps.add(stepIndex);
          for (const mediaPath of extractMediaPaths(accumulated)) {
            this.mediaGenerated.add(mediaPath);
          }
          const cleaned = accumulated.replace(/\s+/g, " ");
          this.recordEvent({
            type: "message",
            stepIndex,
            state: "DONE",
            text: accumulated,
            durationSeconds,
            summary: `💬 ${cleaned.slice(0, 300)}`
          });
        }
      }
      return;
    }
    if (event.event !== "result" || !this.active) return;
    this.clearTimers();
    const pending = this.active;
    this.active = undefined;
    const result = event.result ?? {};
    this.conversationId = typeof result.conversation_id === "string" ? result.conversation_id : this.conversationId;
    this.lastActivity = new Date();
    const finalResponse = typeof result.response === "string" && result.response.length > 0 ? result.response : this.turnText;
    for (const mediaPath of extractMediaPaths(finalResponse)) {
      this.mediaGenerated.add(mediaPath);
    }
    const status = String(result.status ?? "INVALID");
    this.accumulateUsage(result.usage);
    this.currentStep = status === "SUCCESS" ? "✅ Turn completed" : `⚠️ Turn finished (${status})`;
    this.recordEvent({
      type: "result",
      state: status,
      durationSeconds: typeof result.duration_seconds === "number" ? result.duration_seconds : undefined,
      summary: this.currentStep
    });
    const endCursor = this.eventSeq;
    const turnTools = [...this.turnTools];
    const turnSubagents = [...this.turnSubagents];
    const workspaceActivity = this.getWorkspaceActivity();
    const cumulativeUsage = this.getCumulativeUsage();
    setImmediate(() => {
      const errorStr = result.error ? String(result.error) : undefined;
      const diagnosticsStr = status === "SUCCESS" ? undefined : this.diagnostics || undefined;
      const finalResult: AgyResult = {
        conversationId: this.conversationId,
        status,
        response: finalResponse,
        error: errorStr,
        errorCode: status === "SUCCESS" ? undefined : classifyError(errorStr, diagnosticsStr),
        diagnostics: diagnosticsStr,
        durationSeconds: typeof result.duration_seconds === "number" ? result.duration_seconds : undefined,
        numTurns: typeof result.num_turns === "number" ? result.num_turns : undefined,
        usage: result.usage,
        cumulativeUsage,
        tools: turnTools,
        subagents: turnSubagents,
        activeModel: this.activeModel ?? this.options.model,
        permissionMode: this.permissionMode,
        currentStep: this.currentStep,
        workspaceActivity,
        events: this.events.filter((e) => e.seq > pending.startCursor && e.seq <= endCursor),
        nextCursor: endCursor
      };
      this.lastTurnResult = finalResult;
      for (const listener of this.turnFinishListeners) {
        try {
          listener(finalResult);
        } catch {
          /* ignore */
        }
      }
      pending.resolve(finalResult);
      this.advance();
    });
  }

  private appendDiagnostic(value: string): void {
    this.diagnostics = (this.diagnostics + value).slice(-MAX_DIAGNOSTIC_CHARS);
  }

  private fail(error: Error): void {
    if (this.isClosed) return;
    this.state = "failed";
    this.clearTimers();
    this.currentStep = `❌ Error: ${error.message}`;
    this.recordEvent({ type: "error", summary: this.currentStep });
    const result = this.snapshotResult("ERROR", this.active?.startCursor ?? this.eventSeq);
    result.error = error.message;
    result.errorCode = classifyError(error.message, this.diagnostics);
    this.lastTurnResult = result;
    this.active?.reject(error);
    this.active = undefined;
    for (const listener of this.turnFinishListeners) {
      try { listener(result); } catch { /* ignore listener errors */ }
    }
    while (this.queue.length) this.queue.shift()?.reject(error);
  }
}

export function normalizeOptions(options: SessionOptions): SessionOptions {
  const envValue = (process.env.ANTIGRAVITY_SKIP_PERMISSIONS ?? "").toLowerCase();
  const skipPermissions = options.skipPermissions ?? !(envValue === "0" || envValue === "false" || envValue === "no");
  const addDirs = options.addDirs?.map((d) => resolve(d));
  return { ...options, cwd: resolve(options.cwd), addDirs, skipPermissions };
}
