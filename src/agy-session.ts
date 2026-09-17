import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { AgyResult, SessionOptions, SessionSummary } from "./types.js";

const MAX_DIAGNOSTIC_CHARS = 8_000;

interface PendingTurn {
  prompt: string;
  timeoutMs: number;
  resolve: (result: AgyResult) => void;
  reject: (error: Error) => void;
}

export class AgySession {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly queue: PendingTurn[] = [];
  private active?: PendingTurn;
  private inactivityTimer?: NodeJS.Timeout;
  private hardCeilingTimer?: NodeJS.Timeout;
  private currentInactivityMs = 600_000;
  private diagnostics = "";
  private lastActivity = new Date();
  private state: SessionSummary["state"] = "starting";
  private conversationId?: string;
  private turnTools = new Set<string>();
  private turnSubagents: Array<Record<string, unknown>> = [];
  private turnText = "";

  constructor(private readonly binary: string, readonly options: SessionOptions, private readonly onTerminal: () => void) {
    // agy manages its own workspace independently of the child process cwd.
    // Passing --add-dir is therefore required: relying only on spawn({ cwd })
    // silently makes it use its last/default project instead.
    const args = ["--input-format", "stream-json", "--output-format", "stream-json", "--mode", options.mode, "--add-dir", options.cwd];
    if (options.skipPermissions) args.push("--dangerously-skip-permissions");
    if (options.sandbox) args.push("--sandbox");
    if (options.model) args.push("--model", options.model);
    if (options.effort) args.push("--effort", options.effort);
    if (options.agent) args.push("--agent", options.agent);
    this.child = spawn(binary, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.appendDiagnostic(chunk);
      this.refreshInactivityTimer();
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));
    this.child.once("error", (error) => this.fail(error));
    this.child.once("close", (code, signal) => {
      if (this.state !== "closed") this.fail(new Error(`agy session exited (${code ?? "null"}, ${signal ?? "no signal"}). ${this.diagnostics}`));
      this.onTerminal();
    });
  }

  get isClosed(): boolean { return this.state === "closed" || this.state === "failed"; }

  prompt(prompt: string, timeoutMs: number): Promise<AgyResult> {
    if (this.isClosed) return Promise.reject(new Error("Session is closed."));
    return new Promise<AgyResult>((resolve, reject) => {
      this.queue.push({ prompt, timeoutMs, resolve, reject });
      this.advance();
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
      createdAt: this.createdAt.toISOString(),
      lastActivityAt: this.lastActivity.toISOString(),
      queuedTurns: this.queue.length + (this.active ? 1 : 0)
    };
  }

  getDiagnostics(): string { return this.diagnostics; }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.state = "closed";
    this.clearTimers();
    this.active?.reject(new Error("Session was closed."));
    this.active = undefined;
    while (this.queue.length) this.queue.shift()?.reject(new Error("Session was closed."));
    this.child.stdin.end();
    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGTERM");
        resolveClose();
      }, 5_000);
      this.child.once("close", () => { clearTimeout(timer); resolveClose(); });
    });
  }

  private advance(): void {
    if (this.active || this.isClosed) return;
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
    this.currentInactivityMs = turn.timeoutMs;

    this.startInactivityTimer();

    // Hard ceiling safety cap (30 minutes max)
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
    const partialResponse = this.turnText.trim()
      ? `[${reason} Partial output:]\n\n${this.turnText}`
      : reason;
    timedOut.resolve({
      conversationId: this.conversationId,
      status: "TIMEOUT",
      response: partialResponse,
      error: reason,
      diagnostics: this.diagnostics || undefined,
      tools: [...this.turnTools],
      subagents: this.turnSubagents
    });
    this.child.kill("SIGTERM");
  }

  private handleLine(line: string): void {
    this.refreshInactivityTimer();
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch {
      this.appendDiagnostic(`Invalid NDJSON from agy: ${line}\n`);
      return;
    }
    if (event.event === "init") {
      this.conversationId = typeof event.conversation_id === "string" ? event.conversation_id : this.conversationId;
      this.state = "idle";
      return;
    }
    if (event.event === "step_update") {
      const step = event.step_update ?? {};
      if (typeof step.tool_name === "string") this.turnTools.add(step.tool_name);
      if (Array.isArray(step.subagent_info?.subagents)) this.turnSubagents.push(...step.subagent_info.subagents);
      if (typeof step.text_delta === "string") this.turnText += step.text_delta;
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
    pending.resolve({
      conversationId: this.conversationId,
      status: String(result.status ?? "INVALID"),
      response: finalResponse,
      error: result.error ? String(result.error) : undefined,
      diagnostics: String(result.status ?? "INVALID") === "SUCCESS" ? undefined : this.diagnostics || undefined,
      durationSeconds: typeof result.duration_seconds === "number" ? result.duration_seconds : undefined,
      numTurns: typeof result.num_turns === "number" ? result.num_turns : undefined,
      usage: result.usage,
      tools: [...this.turnTools],
      subagents: this.turnSubagents
    });
    this.advance();
  }

  private appendDiagnostic(value: string): void {
    this.diagnostics = (this.diagnostics + value).slice(-MAX_DIAGNOSTIC_CHARS);
  }

  private fail(error: Error): void {
    if (this.isClosed) return;
    this.state = "failed";
    this.clearTimers();
    this.active?.reject(error);
    this.active = undefined;
    while (this.queue.length) this.queue.shift()?.reject(error);
  }
}

export function normalizeOptions(options: SessionOptions): SessionOptions {
  const skipPermissions = options.skipPermissions ?? (process.env.ANTIGRAVITY_SKIP_PERMISSIONS !== "0" && process.env.ANTIGRAVITY_SKIP_PERMISSIONS !== "false");
  return { ...options, cwd: resolve(options.cwd), skipPermissions };
}
