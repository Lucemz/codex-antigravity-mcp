import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findAgy } from "../src/agy-discovery.js";

describe("findAgy", () => {
  it("returns undefined when neither an explicit path nor PATH contains an executable", () => {
    assert.equal(findAgy({ ANTIGRAVITY_AGY_PATH: "/definitely/not/agy", PATH: "/definitely/not/bin" }), undefined);
  });
});
