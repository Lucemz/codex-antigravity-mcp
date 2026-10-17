import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAgy, parseModelsOutput } from "../src/agy-discovery.js";

describe("findAgy", () => {
  it("returns undefined when neither an explicit path nor PATH contains an executable", () => {
    assert.equal(findAgy({ ANTIGRAVITY_AGY_PATH: "/definitely/not/agy", PATH: "/definitely/not/bin" }), undefined);
  });

  it("parses tab-delimited agy models output into clean IDs and modelDetails", () => {
    const raw = "gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\n";
    const parsed = parseModelsOutput(raw);
    assert.deepEqual(parsed.models, ["gemini-3.8-flash-high", "gemini-4-argon-medium"]);
    assert.deepEqual(parsed.modelDetails, [
      { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
      { id: "gemini-4-argon-medium", label: "Gemini 4 Argon (Medium)" }
    ]);
  });
});
