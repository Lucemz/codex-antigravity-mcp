import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSessionCreatedOutput,
  formatSessionListOutput,
  formatStatusOutput,
  formatTurnOutput
} from "../src/format-output.js";

describe("format-output", () => {
  it("formats status into a compact 4-line summary by default and JSON when verbose", () => {
    const status = {
      available: true,
      binary: "/Users/user/.local/bin/agy",
      version: "1.4.0",
      models: ["gemini-4-argon-medium", "gemini-3.8-flash-medium"],
      authentication: "ready" as const,
      capabilities: {
        imageGeneration: true,
        videoEncoding: true,
        goBinary: "/opt/homebrew/bin/go",
        ffmpegBinary: "/opt/homebrew/bin/ffmpeg",
        settingsPermissions: {
          toolPermission: "always-proceed",
          allowNonWorkspaceAccess: true
        }
      }
    };
    const limits = {
      maxSessions: 3,
      idleTimeoutMs: 900_000,
      defaultTurnTimeoutMs: 600_000,
      defaultLiveWindowMs: 20_000
    };

    const compact = formatStatusOutput(status, limits, false);
    assert.match(compact, /^\[READY\] agy 1\.4\.0/);
    assert.match(compact, /models: gemini-4-argon-medium, gemini-3\.8-flash-medium/);
    assert.match(compact, /image-generator=ready, video-encoding=ready, go=\/opt\/homebrew\/bin\/go, ffmpeg=\/opt\/homebrew\/bin\/ffmpeg/);
    assert.equal(compact.split("\n").length, 4);

    const verbose = formatStatusOutput(status, limits, true);
    assert.equal(JSON.parse(verbose).version, "1.4.0");
  });

  it("formats RUNNING turns as a lightweight live subagent ticker without workspaceActivity or partial response bloat", () => {
    const running = formatTurnOutput(
      {
        conversationId: "conv-123",
        status: "RUNNING",
        response: "Long partial response that should not be repeated on every poll...",
        activeModel: "gemini-3.8-flash-medium",
        currentStep: "🔧 run_command: npm test",
        nextCursor: 4,
        tools: ["view_file", "run_command"],
        subagents: [],
        workspaceActivity: {
          filesRead: ["/repo/a.ts", "/repo/b.ts"],
          filesModified: ["/repo/a.ts"],
          commandsRun: [{ command: "npm test", state: "ACTIVE" }],
          mediaGenerated: []
        },
        events: [
          { seq: 3, timestamp: "2026-10-18T00:00:00Z", type: "tool_done", summary: "✔ view_file: /repo/a.ts" },
          { seq: 4, timestamp: "2026-10-18T00:00:01Z", type: "tool_start", summary: "🔧 run_command: npm test" }
        ]
      },
      "sess-1",
      false
    );

    assert.match(running, /^\[RUNNING\] session=sess-1 \| conv=conv-123 \| model=gemini-3\.8-flash-medium \| cursor=4/m);
    assert.match(running, /^stateDetail: 🔧 run_command: npm test$/m);
    assert.match(running, /#3 ✔ view_file: \/repo\/a\.ts/);
    assert.match(running, /#4 🔧 run_command: npm test/);
    assert.match(running, /next: Share these live steps with the user and call antigravity_session_watch\(sessionId="sess-1", cursor=4\)/);
    assert.doesNotMatch(running, /Long partial response/);
    assert.doesNotMatch(running, /filesModified/);
  });

  it("bounds bursty live updates while preserving the cursor and full verbose events", () => {
    const events = Array.from({ length: 500 }, (_, index) => ({
      seq: index + 1,
      timestamp: "2026-10-18T00:00:00Z",
      type: "tool_done" as const,
      summary: `step-${index + 1}: ` + "long output\n".repeat(200)
    }));
    const result = {
      status: "RUNNING",
      response: "partial output",
      currentStep: "working\n".repeat(200),
      tools: [],
      subagents: [],
      events,
      nextCursor: 500
    };
    const compact = formatTurnOutput(result, "sess-burst");
    assert.ok(compact.length < 4_000);
    assert.equal(compact.split("\n").length, 13);
    assert.match(compact, /492 earlier steps omitted/);
    assert.match(compact, /#493 step-493/);
    assert.match(compact, /#500 step-500/);
    assert.doesNotMatch(compact, /#492 /);
    assert.match(compact, /cursor=500/);
    assert.match(compact, /same input cursor/);
    const verbose = JSON.parse(formatTurnOutput(result, "sess-burst", true));
    assert.deepEqual(verbose.events, events);
    assert.equal(verbose.nextCursor, 500);
    assert.equal(verbose.response, "partial output");
  });

  it("keeps empty live updates concise and leaves final answers intact", () => {
    const running = { status: "RUNNING", response: "", tools: [], subagents: [], nextCursor: 0 };
    const compact = formatTurnOutput(running, "sess-empty");
    assert.doesNotMatch(compact, /steps:/);
    assert.match(compact, /cursor=0/);
    const response = "Complete answer\n".repeat(1_000).trim();
    const completed = formatTurnOutput({ ...running, status: "SUCCESS", response }, "sess-empty");
    assert.ok(completed.endsWith(response));
  });

  it("formats completed turns with a concise activity summary followed by raw Markdown response", () => {
    const completed = formatTurnOutput(
      {
        conversationId: "conv-123",
        status: "SUCCESS",
        response: "### Summary\nAll tests passed.",
        activeModel: "gemini-3.8-flash-medium",
        durationSeconds: 3.45,
        usage: { total_tokens: 1500 },
        tools: ["view_file", "replace_file_content", "run_command"],
        subagents: [{ role: "Image Generator", type_name: "image-generator" }],
        workspaceActivity: {
          filesRead: ["src/index.ts"],
          filesModified: ["src/index.ts"],
          commandsRun: [{ command: "npm test", state: "DONE", durationSeconds: 1.2 }],
          mediaGenerated: ["/tmp/icon.png"]
        },
        events: [
          { seq: 1, timestamp: "2026-10-18T00:00:00Z", type: "tool_done", summary: "✔ replace_file_content: src/index.ts" },
          { seq: 2, timestamp: "2026-10-18T00:00:01Z", type: "result", summary: "✅ Turn completed" }
        ],
        nextCursor: 2
      },
      "sess-1",
      false
    );

    assert.match(completed, /^\[SUCCESS\] session=sess-1 \| conv=conv-123 \| model=gemini-3\.8-flash-medium \| 3\.5s \| tokens=1500/m);
    assert.match(completed, /read: src\/index\.ts/);
    assert.match(completed, /modified: src\/index\.ts/);
    assert.match(completed, /commands: npm test \(DONE, 1\.2s\)/);
    assert.match(completed, /media: \/tmp\/icon\.png/);
    assert.match(completed, /subagents: Image Generator/);
    assert.match(completed, /---\n### Summary\nAll tests passed\./);
  });

  it("formats session creation and session list compactly", () => {
    const summary = {
      sessionId: "sess-abc",
      cwd: "/repo",
      mode: "accept-edits" as const,
      sandbox: false,
      skipPermissions: true,
      state: "running" as const,
      activeModel: "gemini-3.8-flash-medium",
      currentStep: "🔧 view_file: README.md",
      cumulativeUsage: { turnsCompleted: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, totalTokens: 0 },
      lastCursor: 2,
      createdAt: "2026-10-18T00:00:00Z",
      lastActivityAt: "2026-10-18T00:00:01Z",
      queuedTurns: 1
    };

    const created = formatSessionCreatedOutput(summary, false);
    assert.match(created, /\[SESSION CREATED\] sessionId=sess-abc \| mode=accept-edits/);

    const list = formatSessionListOutput([summary], false);
    assert.match(list, /sess-abc \[running\] mode=accept-edits \| model=gemini-3\.8-flash-medium \| cursor=2 \| stateDetail: 🔧 view_file: README\.md/);
  });
});
