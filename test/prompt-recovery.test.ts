import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promptWithRecovery, withSubagentGuidance } from "../src/prompt-recovery.js";
import { AgyResult } from "../src/types.js";

const empty: AgyResult = { status: "SUCCESS", response: "", tools: [], subagents: [] };
const report: AgyResult = { status: "SUCCESS", response: "informe recuperado", tools: [], subagents: [] };

describe("promptWithRecovery", () => {
  it("retries once after an empty successful response", async () => {
    const prompts: string[] = [];
    const manager = { get: () => ({ options: { mode: "plan" as const }, prompt: async (prompt: string) => { prompts.push(prompt); return prompts.length === 1 ? { ...empty } : { ...report }; } }) };
    const result = await promptWithRecovery(manager as never, "session", "audita", "auto", 1_000);
    assert.equal(result.response, "informe recuperado");
    assert.equal(result.recoveryAttempted, true);
    assert.equal(prompts.length, 2);
  });

  it("keeps workspace autonomy guidance when subagents are disabled", () => {
    const guided = withSubagentGuidance("hola", "off");
    assert.match(guided, /autonomous expert coding subagent/);
    assert.match(guided, /User task:\nhola/);
    assert.doesNotMatch(guided, /native Antigravity subagents/);
  });

  it("includes subagent delegation directives when strategy is required or auto", () => {
    const required = withSubagentGuidance("tarea compleja", "required");
    assert.match(required, /Decompose the task and use native Antigravity subagents/);

    const auto = withSubagentGuidance("tarea standard", "auto");
    assert.match(auto, /Consider delegating independent or specialized sub-tasks/);
  });

  it("adapts guidance based on accept-edits vs plan mode", () => {
    const edits = withSubagentGuidance("implement feature", "auto", "accept-edits");
    assert.match(edits, /full write and terminal execution authorization/);
    assert.match(edits, /manage git branches/);

    const plan = withSubagentGuidance("review architecture", "auto", "plan");
    assert.match(plan, /in plan mode for inspection and analysis/);
    assert.match(plan, /without modifying files/);
  });
});
