import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findAgy, inspectAgy, isDirectory } from "./agy-discovery.js";
import { AgySession } from "./agy-session.js";
import { SessionManager } from "./session-manager.js";
import { AgyResult, ExecutionMode, SessionOptions } from "./types.js";
import { promptWithRecovery } from "./prompt-recovery.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.ANTIGRAVITY_TURN_TIMEOUT_MS) || 600_000;
const DEFAULT_WAIT_MS = Number(process.env.ANTIGRAVITY_DEFAULT_WAIT_MS) || 20_000;
const ALWAYS_LOAD_META = { "antigravity/alwaysLoad": true };

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

function buildFollowUpHint(result: AgyResult, sessionId?: string): string | undefined {
  if (result.status === "RUNNING") {
    return `Turn is actively running (${result.currentStep ?? "in progress"}). Share the latest timeline steps with the user and call antigravity_session_watch with sessionId="${sessionId ?? ""}" and cursor=${result.nextCursor ?? 0} to keep reading the live channel.`;
  }
  if (result.errorCode === "QUOTA_EXCEEDED") {
    return "Model quota or rate limit was reached. Create a new session with a lighter or alternative model (e.g. 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', or 'gpt-oss-120b-medium') and pass conversationId to resume seamlessly.";
  }
  if (result.errorCode === "AUTH_EXPIRED") {
    return "Antigravity CLI authentication has expired. Ask the user to run 'agy' interactively in their terminal to log back in.";
  }
  return undefined;
}

function resultPayload(result: AgyResult, sessionId?: string) {
  const timeline = (result.events ?? []).map((e) => `[#${e.seq}] ${e.summary}`);
  return {
    sessionId,
    conversationId: result.conversationId,
    status: result.status,
    activeModel: result.activeModel,
    permissionMode: result.permissionMode,
    currentStep: result.currentStep,
    workspaceActivity: result.workspaceActivity,
    cumulativeUsage: result.cumulativeUsage,
    nextCursor: result.nextCursor,
    timeline,
    events: result.events,
    response: result.response,
    error: result.error,
    errorCode: result.errorCode,
    diagnostics: result.diagnostics,
    durationSeconds: result.durationSeconds,
    numTurns: result.numTurns,
    usage: result.usage,
    tools: result.tools,
    subagents: result.subagents,
    recoveryAttempted: result.recoveryAttempted,
    followUpHint: buildFollowUpHint(result, sessionId)
  };
}

function attachLiveStream(
  server: McpServer,
  session: AgySession,
  extra?: { _meta?: { progressToken?: string | number }; sendNotification?: (notification: any) => Promise<void> }
): () => void {
  const progressToken = extra?._meta?.progressToken;
  return session.onEvent((event) => {
    void server.sendLoggingMessage({
      level: event.type === "error" ? "error" : "info",
      logger: "antigravity",
      data: {
        sessionId: session.id,
        conversationId: session.summary().conversationId,
        ...event
      }
    }).catch(() => {});

    if (progressToken !== undefined && typeof extra?.sendNotification === "function") {
      void extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: event.seq,
          message: event.summary
        }
      }).catch(() => {});
    }
  });
}

async function main(): Promise<void> {
  let binary = findAgy();
  let manager = binary ? new SessionManager(binary) : undefined;

  function ensureManager(): { binary: string; manager: SessionManager } {
    if (!binary || !manager) {
      binary = findAgy();
      if (binary) manager = new SessionManager(binary);
    }
    if (!binary || !manager) {
      throw new Error("agy was not found. Install it or set ANTIGRAVITY_AGY_PATH.");
    }
    return { binary, manager };
  }

  const server = new McpServer(
    { name: "codex-antigravity", version: "1.2.0" },
    {
      capabilities: { tools: {}, logging: {}, resources: {} },
      instructions: [
        "When this plugin is explicitly selected or mentioned, treat Antigravity as an autonomous expert coding subagent with a live activity channel.",
        "Invoke at least one Antigravity tool immediately without asking for reconfirmation.",
        "Start with antigravity_status if checking availability, or create a persistent session (antigravity_session_create) for multi-turn work.",
        "LIVE CHANNEL SUPERVISION: antigravity_session_prompt uses a live observation window by default (20s). If Antigravity is still working when the window elapses, it returns status='RUNNING' with timeline, workspaceActivity (filesRead, filesModified, commandsRun, mediaGenerated), and nextCursor without interrupting Antigravity. Immediately brief the user on what Antigravity just did and call antigravity_session_watch(sessionId, cursor=nextCursor) until status='SUCCESS'.",
        "HOT STEERING & CONTEXT COMPACTION: Use antigravity_session_interrupt(sessionId, steerPrompt) if you need to stop or redirect an active turn in-flight while preserving the session conversation history. Set compact=true on antigravity_session_prompt during long multi-turn sessions to compact prior context via /compact before executing the next prompt.",
        "MEDIA, PHOTO, IMAGE & VIDEO GENERATION: Antigravity can generate images/photos via its built-in image-generator subagent (generate_image), capture browser screenshots/videos (capture_browser_screenshot, browser_subagent, webm_encoder), and process video/audio via ffmpeg/sips. All generated media file paths are automatically surfaced in workspaceActivity.mediaGenerated.",
        "Sessions default to non-sandboxed plan mode with autonomous execution in the declared workspace. Use mode='accept-edits' or mode='auto' when the user requests implementations, refactors, media generation saved into the workspace, git branch/commit tasks, or fixes."
      ].join(" ")
    }
  );

  server.registerResource(
    "antigravity-live-sessions",
    "antigravity://sessions/live",
    {
      title: "Active Antigravity Sessions Live Feed",
      description: "Live status, current step, workspace activity, cumulative usage, and recent timeline for all active Antigravity sessions.",
      mimeType: "application/json"
    },
    async () => {
      const sessions = (manager?.list() ?? []).map((summary) => {
        try {
          const s = manager?.get(summary.sessionId);
          return {
            ...summary,
            timeline: (s?.eventsSince(0) ?? []).map((e) => `[#${e.seq}] ${e.summary}`)
          };
        } catch {
          return summary;
        }
      });
      return {
        contents: [
          {
            uri: "antigravity://sessions/live",
            mimeType: "application/json",
            text: JSON.stringify({ sessions }, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool("antigravity_status", {
    description: "Check the local agy binary, available model IDs and labels, authentication readiness, media/toolchain capabilities (image-generator, ffmpeg, webm_encoder, go, permissions), and adapter limits.",
    inputSchema: {},
    _meta: ALWAYS_LOAD_META
  }, async () => text({
    ...(await inspectAgy()),
    limits: {
      maxSessions: 3,
      idleTimeoutMs: 900_000,
      defaultTurnTimeoutMs: DEFAULT_TIMEOUT_MS,
      defaultLiveWindowMs: DEFAULT_WAIT_MS
    }
  }));

  server.registerTool("antigravity_session_create", {
    description: "Start a persistent Antigravity subagent session with a live activity stream. Defaults to non-sandboxed plan mode with autonomous execution within the declared workspace. Use accept-edits or auto for code changes.",
    inputSchema: {
      cwd: z.string().min(1).describe("Existing workspace directory for agy."),
      addDirs: z.array(z.string().min(1)).optional().describe("Additional workspace directories to expose via --add-dir."),
      model: z.string().min(1).optional().describe("Model ID or base model name (e.g. 'gemini-4-argon-medium', 'gemini-3.8-flash-high', 'claude-sonnet-5-5-high')."),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      agent: z.string().min(1).optional(),
      mode: z.enum(["plan", "auto", "accept-edits"]).optional(),
      sandbox: z.boolean().optional(),
      skipPermissions: z.boolean().optional().describe("Allow autonomous tool/command execution in workspace (defaults to true)."),
      conversationId: z.string().min(1).optional().describe("Optional previous conversation_id to resume via --conversation.")
    },
    _meta: ALWAYS_LOAD_META
  }, async (args) => {
    try {
      const { manager: mgr } = ensureManager();
      if (!isDirectory(args.cwd)) throw new Error(`cwd is not a directory: ${args.cwd}`);
      if (args.addDirs) {
        for (const dir of args.addDirs) {
          if (!isDirectory(dir)) throw new Error(`addDir is not a directory: ${dir}`);
        }
      }
      const options: SessionOptions = {
        cwd: args.cwd,
        addDirs: args.addDirs,
        model: args.model,
        effort: args.effort,
        agent: args.agent,
        mode: (args.mode ?? "plan") as ExecutionMode,
        sandbox: args.sandbox ?? false,
        skipPermissions: args.skipPermissions,
        conversationId: args.conversationId
      };
      const session = mgr.create(options);
      return text({
        ...session.summary(),
        message: "Session started with live activity channel. Use antigravity_session_prompt and antigravity_session_watch to monitor progress in real time."
      });
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  server.registerTool("antigravity_session_prompt", {
    description: "Send one prompt to a persistent Antigravity session. Uses a 20s live observation window by default (configurable via waitMs, or disabled with waitForCompletion=true): if the turn is still running after waitMs, returns status='RUNNING' with the live timeline, workspaceActivity, and nextCursor so you can narrate progress and continue watching via antigravity_session_watch.",
    inputSchema: {
      sessionId: z.string().uuid(),
      prompt: z.string().min(1),
      subagents: z.enum(["auto", "required", "off"]).optional(),
      compact: z.boolean().optional().describe("Set true to prefix the turn with /compact so Antigravity summarizes prior conversation context before answering."),
      timeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
      waitMs: z.number().int().min(1_000).max(1_800_000).optional().describe("Live observation window in ms (defaults to 20000). Returns status='RUNNING' with live events if the turn is still working after waitMs, without killing the turn."),
      waitForCompletion: z.boolean().optional().describe("Set true to block until the entire turn finishes instead of returning live RUNNING snapshots.")
    },
    _meta: ALWAYS_LOAD_META
  }, async (args, extra) => {
    let detach: (() => void) | undefined;
    try {
      const { manager: mgr } = ensureManager();
      const session = mgr.get(args.sessionId);
      detach = attachLiveStream(server, session, extra);
      const effectiveWaitMs = args.waitForCompletion ? undefined : (args.waitMs ?? DEFAULT_WAIT_MS);
      const result = await promptWithRecovery(
        mgr,
        args.sessionId,
        args.prompt,
        args.subagents,
        args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        effectiveWaitMs,
        args.compact ?? false
      );
      const isErr = result.status !== "SUCCESS" && result.status !== "RUNNING"
        || (result.status === "SUCCESS" && !result.response.trim());
      return text(resultPayload(result, args.sessionId), isErr);
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : String(error) }, true);
    } finally {
      detach?.();
    }
  });

  server.registerTool("antigravity_session_watch", {
    description: "Read the open live activity channel for a session. Returns all new steps (thoughts, messages, files viewed/edited, commands run, questions, subagents) since cursor. While a turn is running, waits for the next step or up to waitMs.",
    inputSchema: {
      sessionId: z.string().uuid(),
      cursor: z.number().int().min(0).optional().describe("Pass nextCursor from the previous prompt/watch response to receive only new events (defaults to 0)."),
      waitMs: z.number().int().min(0).max(120_000).optional().describe("Max time in ms to wait for new live activity (defaults to 15000). Use 0 for an instant non-blocking peek."),
      returnOnStep: z.boolean().optional().describe("When true (default), returns as soon as a new step/message/tool event arrives so you can report live progress immediately.")
    },
    _meta: ALWAYS_LOAD_META
  }, async (args, extra) => {
    let detach: (() => void) | undefined;
    try {
      const { manager: mgr } = ensureManager();
      const session = mgr.get(args.sessionId);
      detach = attachLiveStream(server, session, extra);
      const result = await session.watch({
        cursor: args.cursor,
        waitMs: args.waitMs,
        returnOnStep: args.returnOnStep
      });
      const isErr = result.status === "ERROR" || result.status === "TIMEOUT";
      return text(resultPayload(result, args.sessionId), isErr);
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : String(error) }, true);
    } finally {
      detach?.();
    }
  });

  server.registerTool("antigravity_session_interrupt", {
    description: "Interrupt an active turn in-flight without destroying the session. Automatically reconnects the underlying agy process to the same conversationId and optionally sends a new steerPrompt immediately.",
    inputSchema: {
      sessionId: z.string().uuid(),
      reason: z.string().min(1).optional().describe("Reason for interrupting the current turn."),
      steerPrompt: z.string().min(1).optional().describe("Optional new instruction to run immediately after interrupting the current turn."),
      subagents: z.enum(["auto", "required", "off"]).optional(),
      waitMs: z.number().int().min(1_000).max(1_800_000).optional()
    },
    _meta: ALWAYS_LOAD_META
  }, async (args, extra) => {
    let detach: (() => void) | undefined;
    try {
      const { manager: mgr } = ensureManager();
      const session = mgr.get(args.sessionId);
      detach = attachLiveStream(server, session, extra);
      const interruptedResult = await session.interrupt(args.reason ?? "Interrupted by supervisor.");
      if (!args.steerPrompt) {
        return text(resultPayload(interruptedResult, args.sessionId), false);
      }
      const steered = await promptWithRecovery(
        mgr,
        args.sessionId,
        args.steerPrompt,
        args.subagents,
        DEFAULT_TIMEOUT_MS,
        args.waitMs ?? DEFAULT_WAIT_MS
      );
      return text({
        interruptedTurn: {
          status: interruptedResult.status,
          partialResponse: interruptedResult.response
        },
        ...resultPayload(steered, args.sessionId)
      }, steered.status !== "SUCCESS" && steered.status !== "RUNNING");
    } catch (error) {
      return text({ error: error instanceof Error ? error.message : String(error) }, true);
    } finally {
      detach?.();
    }
  });

  server.registerTool("antigravity_session_list", {
    description: "List active persistent Antigravity sessions with their current live step, active model, workspaceActivity, cumulativeUsage, and event cursor.",
    inputSchema: {},
    _meta: ALWAYS_LOAD_META
  }, async () => text({ sessions: manager?.list() ?? [] }));

  server.registerTool("antigravity_session_close", {
    description: "Close a persistent Antigravity session. Safe to call for an already-closed session.",
    inputSchema: { sessionId: z.string().uuid() },
    _meta: ALWAYS_LOAD_META
  }, async (args) => {
    try {
      await manager?.close(args.sessionId);
      return text({ sessionId: args.sessionId, closed: true });
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  server.registerTool("antigravity_run", {
    description: "Run one isolated Antigravity subagent turn and return the response along with the full chronological activity timeline and workspaceActivity. Use a persistent session (antigravity_session_create + antigravity_session_prompt + antigravity_session_watch) for live multi-step supervision.",
    inputSchema: {
      cwd: z.string().min(1),
      addDirs: z.array(z.string().min(1)).optional(),
      prompt: z.string().min(1),
      model: z.string().min(1).optional(),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      agent: z.string().min(1).optional(),
      mode: z.enum(["plan", "auto", "accept-edits"]).optional(),
      sandbox: z.boolean().optional(),
      skipPermissions: z.boolean().optional().describe("Allow autonomous tool/command execution in workspace (defaults to true)."),
      conversationId: z.string().min(1).optional().describe("Optional previous conversation_id to resume via --conversation."),
      subagents: z.enum(["auto", "required", "off"]).optional(),
      timeoutMs: z.number().int().min(1_000).max(1_800_000).optional()
    },
    _meta: ALWAYS_LOAD_META
  }, async (args, extra) => {
    let id: string | undefined;
    let detach: (() => void) | undefined;
    try {
      const { manager: mgr } = ensureManager();
      if (!isDirectory(args.cwd)) throw new Error(`cwd is not a directory: ${args.cwd}`);
      if (args.addDirs) {
        for (const dir of args.addDirs) {
          if (!isDirectory(dir)) throw new Error(`addDir is not a directory: ${dir}`);
        }
      }
      const session = mgr.create({
        cwd: args.cwd,
        addDirs: args.addDirs,
        model: args.model,
        effort: args.effort,
        agent: args.agent,
        mode: (args.mode ?? "plan") as ExecutionMode,
        sandbox: args.sandbox ?? false,
        skipPermissions: args.skipPermissions,
        conversationId: args.conversationId
      });
      id = session.id;
      detach = attachLiveStream(server, session, extra);
      const result = await promptWithRecovery(mgr, session.id, args.prompt, args.subagents, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return text(resultPayload(result, session.id), result.status !== "SUCCESS" || !result.response.trim());
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
    finally {
      detach?.();
      if (id) await manager?.close(id);
    }
  });

  const shutdown = () => void manager?.shutdown();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await server.connect(new StdioServerTransport());
}

void main().catch((error) => {
  process.stderr.write(`Fatal MCP startup error: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
