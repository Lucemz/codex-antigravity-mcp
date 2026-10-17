import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promptWithRecovery, withSubagentGuidance } from "../src/prompt-recovery.js";
import { AgyResult } from "../src/types.js";

const empty: AgyResult = { status: "SUCCESS", response: "", tools: [], subagents: [] };
const report: AgyResult = { status: "SUCCESS", response: "recovered report", tools: [], subagents: [] };

describe("promptWithRecovery", () => {
  it("retries once after an empty successful response", async () => {
    const prompts: string[] = [];
    const manager = {
      get: () => ({
        options: { mode: "plan" as const },
        prompt: async (prompt: string) => {
          prompts.push(prompt);
          return prompts.length === 1 ? { ...empty } : { ...report };
        }
      })
    };
    const result = await promptWithRecovery(manager as never, "session", "audit repository", "auto", 1_000);
    assert.equal(result.response, "recovered report");
    assert.equal(result.recoveryAttempted, true);
    assert.equal(prompts.length, 2);
  });

  it("keeps workspace autonomy guidance when subagents are disabled", () => {
    const guided = withSubagentGuidance("hello", "off");
    assert.match(guided, /autonomous expert coding subagent/);
    assert.match(guided, /Never call `ask_question`/);
    assert.match(guided, /User task:\nhello/);
    assert.doesNotMatch(guided, /native Antigravity subagents/);
  });

  it("includes subagent delegation directives and /compact prefix when requested", () => {
    const required = withSubagentGuidance("complex task", "required", "auto", true);
    assert.ok(required.startsWith("/compact "));
    assert.match(required, /Decompose the task and use native Antigravity subagents/);

    const auto = withSubagentGuidance("standard task", "auto");
    assert.match(auto, /Consider delegating independent or specialized sub-tasks/);
  });

  it("adapts guidance based on accept-edits, auto, and plan modes", () => {
    const edits = withSubagentGuidance("implement feature", "auto", "accept-edits");
    assert.match(edits, /full write and terminal execution authorization/);
    assert.match(edits, /manage git branches/);

    const plan = withSubagentGuidance("review architecture", "auto", "plan");
    assert.match(plan, /in plan mode for inspection and analysis/);
    assert.match(plan, /without modifying files/);

    const autoMode = withSubagentGuidance("refactor module", "auto", "auto");
    assert.match(autoMode, /in auto mode: file edits and safe workspace commands are approved automatically/);
  });

  it("returns RUNNING immediately when promptWindow yields before turn completion", async () => {
    const runningResult: AgyResult = {
      status: "RUNNING",
      response: "",
      currentStep: "🔧 view_file: src/index.ts",
      nextCursor: 3,
      tools: ["view_file"],
      subagents: []
    };
    const manager = {
      get: () => ({
        options: { mode: "auto" as const },
        prompt: async () => empty,
        promptWindow: async () => runningResult
      })
    };
    const result = await promptWithRecovery(manager as never, "session", "long task", "auto", 600_000, 15_000);
    assert.equal(result.status, "RUNNING");
    assert.equal(result.nextCursor, 3);
    assert.equal(result.recoveryAttempted, undefined);
  });
});
