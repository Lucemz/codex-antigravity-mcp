import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findAgy, inspectAgy, isDirectory } from "./agy-discovery.js";
import { SessionManager } from "./session-manager.js";
import { AgyResult, ExecutionMode, SessionOptions } from "./types.js";
import { promptWithRecovery } from "./prompt-recovery.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.ANTIGRAVITY_TURN_TIMEOUT_MS) || 600_000;

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

function resultPayload(result: AgyResult) {
  return {
    conversationId: result.conversationId,
    status: result.status,
    response: result.response,
    error: result.error,
    diagnostics: result.diagnostics,
    durationSeconds: result.durationSeconds,
    numTurns: result.numTurns,
    usage: result.usage,
    tools: result.tools,
    subagents: result.subagents,
    recoveryAttempted: result.recoveryAttempted
  };
}

async function main(): Promise<void> {
  const binary = findAgy();
  const manager = binary ? new SessionManager(binary) : undefined;
  const server = new McpServer(
    { name: "codex-antigravity", version: "1.0.1" },
    {
      capabilities: { tools: {} },
      instructions: "When this plugin is explicitly selected or mentioned, treat Antigravity as an autonomous expert coding subagent. Invoke at least one Antigravity tool immediately without asking for reconfirmation. Start with antigravity_status if checking availability, or create a persistent session for multi-turn work, reuse it for follow-ups, and close it when done. Sessions default to non-sandboxed plan mode with autonomous execution in the declared workspace. Use accept-edits when the user requests implementations, refactors, or fixes. Antigravity inspects files, runs validations, and leverages native subagents directly. Pass complete task context to Antigravity and present its structured output directly to the user."
    }
  );

  server.registerTool("antigravity_status", {
    description: "Check the local agy binary, available models, authentication readiness, and adapter limits.",
    inputSchema: {}
  }, async () => text({ ...(await inspectAgy()), limits: { maxSessions: 3, idleTimeoutMs: 900_000, defaultTurnTimeoutMs: DEFAULT_TIMEOUT_MS } }));

  server.registerTool("antigravity_session_create", {
    description: "Start a persistent Antigravity subagent session. Defaults to non-sandboxed plan mode with autonomous execution within the declared workspace. Edits require explicit accept-edits.",
    inputSchema: {
      cwd: z.string().min(1).describe("Existing workspace directory for agy."),
      model: z.string().min(1).optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      agent: z.string().min(1).optional(),
      mode: z.enum(["plan", "accept-edits"]).optional(),
      sandbox: z.boolean().optional(),
      skipPermissions: z.boolean().optional().describe("Allow autonomous tool/command execution in workspace (defaults to true).")
    }
  }, async (args) => {
    try {
      if (!manager || !binary) throw new Error("agy was not found. Install it or set ANTIGRAVITY_AGY_PATH.");
      if (!isDirectory(args.cwd)) throw new Error(`cwd is not a directory: ${args.cwd}`);
      const options: SessionOptions = {
        cwd: args.cwd,
        model: args.model,
        effort: args.effort,
        agent: args.agent,
        mode: (args.mode ?? "plan") as ExecutionMode,
        sandbox: args.sandbox ?? false,
        skipPermissions: args.skipPermissions
      };
      const session = manager.create(options);
      return text({ ...session.summary(), message: "Session started. Use antigravity_session_prompt with this sessionId." });
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  server.registerTool("antigravity_session_prompt", {
    description: "Send one prompt to a persistent Antigravity session and wait for its result event.",
    inputSchema: {
      sessionId: z.string().uuid(),
      prompt: z.string().min(1),
      subagents: z.enum(["auto", "required", "off"]).optional(),
      timeoutMs: z.number().int().min(1_000).max(1_800_000).optional()
    }
  }, async (args) => {
    try {
      if (!manager) throw new Error("agy is unavailable.");
      const result = await promptWithRecovery(manager, args.sessionId, args.prompt, args.subagents, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return text(resultPayload(result), result.status !== "SUCCESS" || !result.response.trim());
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  server.registerTool("antigravity_session_list", {
    description: "List active persistent Antigravity sessions without exposing prompt contents or stderr logs.",
    inputSchema: {}
  }, async () => text({ sessions: manager?.list() ?? [] }));

  server.registerTool("antigravity_session_close", {
    description: "Close a persistent Antigravity session. Safe to call for an already-closed session.",
    inputSchema: { sessionId: z.string().uuid() }
  }, async (args) => {
    try {
      await manager?.close(args.sessionId);
      return text({ sessionId: args.sessionId, closed: true });
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
  });

  server.registerTool("antigravity_run", {
    description: "Run one isolated Antigravity subagent turn. Use a persistent session instead for follow-up work.",
    inputSchema: {
      cwd: z.string().min(1),
      prompt: z.string().min(1),
      model: z.string().min(1).optional(),
      effort: z.enum(["low", "medium", "high"]).optional(),
      agent: z.string().min(1).optional(),
      mode: z.enum(["plan", "accept-edits"]).optional(),
      sandbox: z.boolean().optional(),
      skipPermissions: z.boolean().optional().describe("Allow autonomous tool/command execution in workspace (defaults to true)."),
      subagents: z.enum(["auto", "required", "off"]).optional(),
      timeoutMs: z.number().int().min(1_000).max(1_800_000).optional()
    }
  }, async (args) => {
    let id: string | undefined;
    try {
      if (!manager) throw new Error("agy is unavailable.");
      if (!isDirectory(args.cwd)) throw new Error(`cwd is not a directory: ${args.cwd}`);
      const session = manager.create({
        cwd: args.cwd, model: args.model, effort: args.effort, agent: args.agent,
        mode: (args.mode ?? "plan") as ExecutionMode, sandbox: args.sandbox ?? false,
        skipPermissions: args.skipPermissions
      });
      id = session.id;
      const result = await promptWithRecovery(manager, session.id, args.prompt, args.subagents, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return text(resultPayload(result), result.status !== "SUCCESS" || !result.response.trim());
    } catch (error) { return text({ error: error instanceof Error ? error.message : String(error) }, true); }
    finally { if (id) await manager?.close(id); }
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
