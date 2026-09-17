import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgySession } from "../src/agy-session.js";
import { SessionManager } from "../src/session-manager.js";

function fakeAgy(): string {
  const directory = join(tmpdir(), `fake-agy-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const binary = join(directory, "agy");
  writeFileSync(binary, `#!/usr/bin/env node
const readline = require('node:readline');
if (!process.argv.includes('--add-dir')) { process.stderr.write('missing --add-dir'); process.exit(9); }
let count = 0;
console.log(JSON.stringify({event:'init',conversation_id:'fake-conversation'}));
readline.createInterface({input:process.stdin}).on('line', line => {
  const input = JSON.parse(line); count++;
  if (input.message.content === 'bad-json') { console.log('not json'); }
  if (input.message.content === 'unknown-event') { console.log(JSON.stringify({event:'progress',message:'ignored'})); }
  console.error('diagnostic-' + count);
  console.log(JSON.stringify({event:'step_update',step_update:{tool_name:'run_command'}}));
  if (input.message.content === 'delta-only') { console.log(JSON.stringify({event:'step_update',step_update:{text_delta:'streamed report'}})); }
  const failed = input.message.content === 'terminal-error';
  console.log(JSON.stringify({event:'result',result:{conversation_id:'fake-conversation',status:failed ? 'ERROR' : 'SUCCESS',error:failed ? 'permission denied' : undefined,response:input.message.content === 'delta-only' ? '' : input.message.content + '-' + count,num_turns:count,usage:{total_tokens:count}}}));
});`);
  chmodSync(binary, 0o755);
  return binary;
}

describe("AgySession", () => {
  it("serializes turns and retains session context metadata", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: true }, () => {});
    const [first, second] = await Promise.all([session.prompt("one", 1_000), session.prompt("two", 1_000)]);
    assert.equal(first.response, "one-1");
    assert.equal(second.response, "two-2");
    assert.deepEqual(second.tools, ["run_command"]);
    assert.equal(session.summary().conversationId, "fake-conversation");
    assert.match(session.getDiagnostics(), /diagnostic-2/);
    await session.close();
  });

  it("times out and returns structured partial status without throwing", async () => {
    const directory = join(tmpdir(), `slow-agy-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, "agy");
    writeFileSync(binary, "#!/usr/bin/env node\nprocess.stdin.resume();");
    chmodSync(binary, 0o755);
    const session = new AgySession(binary, { cwd: process.cwd(), mode: "plan", sandbox: true }, () => {});
    const result = await session.prompt("slow", 30);
    assert.equal(result.status, "TIMEOUT");
    assert.match(result.error ?? "", /timed out/);
  });

  it("returns streamed text when the final result response is empty", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    const result = await session.prompt("delta-only", 1_000);
    assert.equal(result.response, "streamed report");
    await session.close();
  });

  it("returns bounded stderr diagnostics for a terminal error", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    const result = await session.prompt("terminal-error", 1_000);
    assert.equal(result.status, "ERROR");
    assert.equal(result.error, "permission denied");
    assert.match(result.diagnostics ?? "", /diagnostic-1/);
    await session.close();
  });

  it("ignores malformed and unknown stdout events without losing the turn", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    const malformed = await session.prompt("bad-json", 1_000);
    const unknown = await session.prompt("unknown-event", 1_000);
    assert.equal(malformed.response, "bad-json-1");
    assert.equal(unknown.response, "unknown-event-2");
    assert.match(session.getDiagnostics(), /Invalid NDJSON/);
    await session.close();
  });

  it("enforces the concurrent-session limit", async () => {
    const manager = new SessionManager(fakeAgy(), 3, 60_000);
    const sessions = [manager.create({ cwd: process.cwd(), mode: "plan", sandbox: false }), manager.create({ cwd: process.cwd(), mode: "plan", sandbox: false }), manager.create({ cwd: process.cwd(), mode: "plan", sandbox: false })];
    assert.throws(() => manager.create({ cwd: process.cwd(), mode: "plan", sandbox: false }), /Session limit reached/);
    await Promise.all(sessions.map((session) => manager.close(session.id)));
    await manager.shutdown();
  });

  it("rejects prompts for a nonexistent session", () => {
    const manager = new SessionManager(fakeAgy(), 3, 60_000);
    assert.throws(() => manager.get("missing"), /Unknown session/);
    void manager.shutdown();
  });

  it("passes --dangerously-skip-permissions by default in session options", async () => {
    const directory = join(tmpdir(), `check-flags-agy-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, "agy");
    writeFileSync(binary, `#!/usr/bin/env node
const readline = require('node:readline');
const hasSkip = process.argv.includes('--dangerously-skip-permissions');
console.log(JSON.stringify({event:'init',conversation_id:'flag-test'}));
readline.createInterface({input:process.stdin}).on('line', () => {
  console.log(JSON.stringify({event:'result',result:{conversation_id:'flag-test',status:'SUCCESS',response:hasSkip ? 'flags-ok' : 'missing-flag'}}));
});`);
    chmodSync(binary, 0o755);
    const session = new AgySession(binary, { cwd: process.cwd(), mode: "plan", sandbox: false, skipPermissions: true }, () => {});
    const result = await session.prompt("check", 1_000);
    assert.equal(result.response, "flags-ok");
    await session.close();
  });
});
