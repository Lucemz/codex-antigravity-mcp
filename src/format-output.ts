import { AgyStatus } from "./agy-discovery.js";
import { AgyResult, SessionSummary } from "./types.js";

const MAX_LIVE_STEPS = 8;
const MAX_PREVIEW_CHARS = 300;

function livePreview(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > MAX_PREVIEW_CHARS
    ? `${singleLine.slice(0, MAX_PREVIEW_CHARS - 1)}…`
    : singleLine;
}


export function buildFollowUpHint(result: AgyResult, sessionId?: string): string | undefined {
  if (result.status === "RUNNING") {
    return `Share these live steps with the user and call antigravity_session_watch(sessionId="${sessionId ?? ""}", cursor=${result.nextCursor ?? 0})`;
  }
  if (result.errorCode === "QUOTA_EXCEEDED") {
    return "Model quota or rate limit was reached. Create a new session with a lighter or alternative model (e.g. 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', or 'gpt-oss-120b-medium') and pass conversationId to resume seamlessly.";
  }
  if (result.errorCode === "AUTH_EXPIRED") {
    return "Antigravity CLI authentication has expired. Ask the user to run 'agy' interactively in their terminal to log back in.";
  }
  return undefined;
}

export function resultPayload(result: AgyResult, sessionId?: string) {
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

export function formatStatusOutput(
  status: AgyStatus,
  limits: { maxSessions: number; idleTimeoutMs: number; defaultTurnTimeoutMs: number; defaultLiveWindowMs: number },
  verbose = false
): string {
  if (verbose) {
    return JSON.stringify({ ...status, limits }, null, 2);
  }
  if (!status.available) {
    return `[UNAVAILABLE] auth=${status.authentication} | ${status.diagnostics ?? "agy binary not found"}`;
  }
  const caps = status.capabilities;
  const perms = caps?.settingsPermissions;
  const lines = [
    `[READY] agy ${status.version ?? "unknown"} (${status.binary ?? "agy"}) | auth=${status.authentication}`,
    `models: ${(status.models ?? []).join(", ") || "none"}`,
    `capabilities: image-generator=${caps?.imageGeneration ? "ready" : "off"}, video-encoding=${caps?.videoEncoding ? "ready" : "off"}${caps?.goBinary ? `, go=${caps.goBinary}` : ""}${caps?.ffmpegBinary ? `, ffmpeg=${caps.ffmpegBinary}` : ""}${perms?.toolPermission ? `, permissions=${perms.toolPermission}` : ""}${perms?.allowNonWorkspaceAccess !== undefined ? ` (non-workspace=${perms.allowNonWorkspaceAccess})` : ""}`,
    `limits: maxSessions=${limits.maxSessions}, liveWindow=${Math.round(limits.defaultLiveWindowMs / 1000)}s, turnTimeout=${Math.round(limits.defaultTurnTimeoutMs / 1000)}s`
  ];
  if (status.diagnostics) {
    lines.push(`diagnostics: ${status.diagnostics}`);
  }
  return lines.join("\n");
}

export function formatSessionCreatedOutput(summary: SessionSummary, verbose = false): string {
  if (verbose) {
    return JSON.stringify({
      ...summary,
      message: "Session started with live activity channel. Use antigravity_session_prompt and antigravity_session_watch to monitor progress in real time."
    }, null, 2);
  }
  const parts = [
    `[SESSION CREATED] sessionId=${summary.sessionId}`,
    `mode=${summary.mode}`,
    `model=${summary.activeModel ?? "default"}`,
    `cwd=${summary.cwd}`
  ];
  if (summary.conversationId) parts.push(`conv=${summary.conversationId}`);
  return [
    parts.join(" | "),
    `next: call antigravity_session_prompt(sessionId="${summary.sessionId}", prompt="...")`
  ].join("\n");
}

export function formatTurnOutput(result: AgyResult, sessionId?: string, verbose = false): string {
  if (verbose) {
    return JSON.stringify(resultPayload(result, sessionId), null, 2);
  }

  const events = result.events ?? [];
  const hint = buildFollowUpHint(result, sessionId);

  // 1. Lightweight live subagent ticker when turn is still RUNNING
  if (result.status === "RUNNING") {
    const headerParts = [
      `[RUNNING] session=${sessionId ?? "ephemeral"}`,
      result.conversationId ? `conv=${result.conversationId}` : undefined,
      result.activeModel ? `model=${result.activeModel}` : undefined,
      `cursor=${result.nextCursor ?? 0}`
    ].filter(Boolean);

    const lines: string[] = [
      headerParts.join(" | "),
      `stateDetail: ${livePreview(result.currentStep ?? "⏳ Working...")}`
    ];

    if (events.length > 0) {
      lines.push("steps:");
      const recent = events.slice(-MAX_LIVE_STEPS);
      const omitted = events.length - recent.length;
      if (omitted > 0) {
        lines.push(`  ${omitted} earlier steps omitted; repeat this request with verbose=true and the same input cursor for buffered events.`);
      }
      for (const ev of recent) {
        lines.push(`  #${ev.seq} ${livePreview(ev.summary)}`);
      }
    }

    if (hint) {
      lines.push(`next: ${hint}`);
    }
    return lines.join("\n");
  }

  // 2. Completed turn summary + final markdown response
  const totalTokens =
    typeof result.usage?.total_tokens === "number"
      ? result.usage.total_tokens
      : result.cumulativeUsage?.totalTokens;
  const headerParts = [
    `[${result.status}] session=${sessionId ?? "ephemeral"}`,
    result.conversationId ? `conv=${result.conversationId}` : undefined,
    result.activeModel ? `model=${result.activeModel}` : undefined,
    result.durationSeconds !== undefined ? `${result.durationSeconds.toFixed(1)}s` : undefined,
    totalTokens ? `tokens=${totalTokens}` : undefined
  ].filter(Boolean);

  const lines: string[] = [headerParts.join(" | ")];

  const activityLines: string[] = [];
  const wa = result.workspaceActivity;
  if (wa) {
    if (wa.filesRead.length > 0) activityLines.push(`  read: ${wa.filesRead.join(", ")}`);
    if (wa.filesModified.length > 0) activityLines.push(`  modified: ${wa.filesModified.join(", ")}`);
    if (wa.commandsRun.length > 0) {
      const cmds = wa.commandsRun.map(
        (c) => `${c.command} (${c.state}${c.durationSeconds !== undefined ? `, ${c.durationSeconds.toFixed(1)}s` : ""})`
      );
      activityLines.push(`  commands: ${cmds.join("; ")}`);
    }
    if (wa.mediaGenerated.length > 0) {
      activityLines.push(`  media: ${wa.mediaGenerated.join(", ")}`);
    }
  }
  if (result.subagents.length > 0) {
    const subs = result.subagents.map(
      (s: any) => s.role || s.Role || s.type_name || s.type || s.conversation_id || "subagent"
    );
    activityLines.push(`  subagents: ${subs.join(", ")}`);
  }
  const nonFinalEvents = events.filter(
    (ev) => ev.type !== "result" && !(ev.type === "message" && ev.text?.trim() === result.response.trim())
  );
  if (nonFinalEvents.length > 0) {
    const recent = nonFinalEvents.slice(-8);
    activityLines.push(`  steps (${nonFinalEvents.length}):`);
    for (const ev of recent) {
      activityLines.push(`    #${ev.seq} ${ev.summary}`);
    }
  }

  if (activityLines.length > 0) {
    lines.push("activity:");
    lines.push(...activityLines);
  }

  if (result.error) {
    lines.push(`error: ${result.errorCode ? `[${result.errorCode}] ` : ""}${result.error}`);
  }
  if (result.diagnostics && result.status !== "SUCCESS") {
    lines.push(`diagnostics: ${result.diagnostics.trim().slice(-500)}`);
  }
  if (hint) {
    lines.push(`hint: ${hint}`);
  }

  if (result.response.trim()) {
    lines.push("---");
    lines.push(result.response.trim());
  }

  return lines.join("\n");
}

export function formatSessionListOutput(sessions: SessionSummary[], verbose = false): string {
  if (verbose) {
    return JSON.stringify({ sessions }, null, 2);
  }
  if (sessions.length === 0) {
    return "No active Antigravity sessions.";
  }
  const lines = [`Active sessions (${sessions.length}):`];
  for (const s of sessions) {
    lines.push(
      `- ${s.sessionId} [${s.state}] mode=${s.mode} | model=${s.activeModel ?? "default"} | cursor=${s.lastCursor} | stateDetail: ${s.currentStep ?? "idle"}`
    );
  }
  return lines.join("\n");
}
