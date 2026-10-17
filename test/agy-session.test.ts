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
  if (input.message.content === 'bad-json') { console.log('not json'); console.log('null'); }
  if (input.message.content === 'unknown-event') { console.log(JSON.stringify({event:'progress',message:'ignored'})); }
  console.error('diagnostic-' + count);
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:1,tool_name:'run_command',tool_info:{parameters:{CommandLine:'npm test'}}}}));
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

  it("retains commands with reused step indices across turns", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    try {
      await session.prompt("one", 1_000);
      await session.prompt("two", 1_000);
      assert.equal(session.getWorkspaceActivity().commandsRun.length, 2);
    } finally {
      await session.close();
    }
  });

  it("does not reopen a closed session on interrupt", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    await session.close();
    await assert.rejects(session.interrupt(), /Session is closed/);
    assert.equal(session.summary().state, "closed");
  });

  it("notifies watchers immediately when the process fails", async () => {
    const session = new AgySession(fakeAgy(), { cwd: process.cwd(), mode: "plan", sandbox: false }, () => {});
    try {
      await session.prompt("init", 1_000);
      const running = session.prompt("pending", 1_000).catch(() => undefined);
      const watching = session.watch({ cursor: session.getCursor(), waitMs: 10_000, returnOnStep: false });
      (session as any).fail(new Error("process crashed"));
      const result = await watching;
      assert.equal(result.status, "ERROR");
      assert.equal(result.error, "process crashed");
      await running;
    } finally {
      await session.close();
    }
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

  it("streams live activity events with promptWindow (RUNNING) and watch() until SUCCESS", async () => {
    const directory = join(tmpdir(), `live-stream-agy-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, "agy");
    writeFileSync(binary, `#!/usr/bin/env node
const readline = require('node:readline');
console.log(JSON.stringify({event:'init',conversation_id:'live-conv',init:{model:'gemini-4-argon-medium',permission_mode:'always-proceed'}}));
readline.createInterface({input:process.stdin}).on('line', () => {
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:1,state:'ACTIVE',step_type:'agent_response',text_delta:'Inspecting package.json...'}}));
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:1,state:'DONE',step_type:'agent_response',text_delta:'\\n',duration_seconds:0.2}}));
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'tool',tool_name:'view_file',tool_info:{name:'view_file',parameters:{AbsolutePath:'/repo/package.json'}}}}));
  setTimeout(() => {
    console.log(JSON.stringify({event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'tool',tool_name:'view_file',duration_seconds:0.05,tool_info:{name:'view_file',parameters:{AbsolutePath:'/repo/package.json'},output:'25 lines'}}}));
    console.log(JSON.stringify({event:'result',result:{conversation_id:'live-conv',status:'SUCCESS',response:'Finished inspection',duration_seconds:0.4,num_turns:1}}));
  }, 450);
});`);
    chmodSync(binary, 0o755);
    const session = new AgySession(binary, { cwd: process.cwd(), mode: "auto", sandbox: false, skipPermissions: true }, () => {});
    try {
      const liveObserved: string[] = [];
      session.onEvent((ev) => liveObserved.push(ev.summary));

      const firstWindow = await session.promptWindow("audit repo", 5_000, 250);
      assert.equal(firstWindow.status, "RUNNING");
      assert.equal(firstWindow.activeModel, "gemini-4-argon-medium");
      assert.equal(firstWindow.permissionMode, "always-proceed");
      assert.ok((firstWindow.events ?? []).some((e) => e.type === "message" && e.summary.includes("Inspecting package.json")));
      assert.ok((firstWindow.events ?? []).some((e) => e.type === "tool_start" && e.target === "/repo/package.json"));

      const finalWatch = await session.watch({ cursor: firstWindow.nextCursor, waitMs: 2_000, returnOnStep: false });
      assert.equal(finalWatch.status, "SUCCESS");
      assert.equal(finalWatch.response, "Finished inspection");
      assert.ok((finalWatch.events ?? []).some((e) => e.type === "tool_done" && e.outputPreview === "25 lines"));
      assert.deepEqual(finalWatch.workspaceActivity?.filesRead, ["/repo/package.json"]);
      assert.ok(liveObserved.length >= 4);
    } finally {
      await session.close();
    }
  });

  it("tracks workspaceActivity (filesModified, commandsRun, thoughts) and supports hot interrupt + resume", async () => {
    const directory = join(tmpdir(), `interrupt-agy-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, "agy");
    writeFileSync(binary, `#!/usr/bin/env node
const readline = require('node:readline');
const resumedIdx = process.argv.indexOf('--conversation');
const resumedId = resumedIdx >= 0 ? process.argv[resumedIdx + 1] : null;
console.log(JSON.stringify({event:'init',conversation_id:resumedId || 'conv-interrupt-1',init:{model:'gemini-3.8-flash-medium',permission_mode:'always-proceed'}}));
readline.createInterface({input:process.stdin}).on('line', line => {
  const input = JSON.parse(line);
  if (input.message.content.includes('hang-turn')) {
    console.log(JSON.stringify({event:'step_update',step_update:{step_index:1,state:'DONE',thinking_delta:'Analyzing edit target...'}}));
    console.log(JSON.stringify({event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'tool',tool_name:'replace_file_content',tool_info:{name:'replace_file_content',parameters:{TargetFile:'/repo/src/app.ts'},output:'updated'}}}));
    console.log(JSON.stringify({event:'step_update',step_update:{step_index:3,state:'ACTIVE',step_type:'tool',tool_name:'run_command',tool_info:{name:'run_command',parameters:{CommandLine:'npm test'}}}}));
    // Intentionally stay open until interrupted
  } else {
    console.log(JSON.stringify({event:'result',result:{conversation_id:resumedId || 'conv-interrupt-1',status:'SUCCESS',response:'Steered on ' + (resumedId || 'new')}}));
  }
});`);
    chmodSync(binary, 0o755);
    const session = new AgySession(binary, { cwd: process.cwd(), mode: "accept-edits", sandbox: false, skipPermissions: true }, () => {});
    try {
      const firstWindow = await session.promptWindow("hang-turn", 10_000, 250);
      assert.equal(firstWindow.status, "RUNNING");
      assert.deepEqual(firstWindow.workspaceActivity?.filesModified, ["/repo/src/app.ts"]);
      assert.equal(firstWindow.workspaceActivity?.commandsRun[0]?.command, "npm test");

      const interrupted = await session.interrupt("Redirecting to faster test");
      assert.equal(interrupted.status, "INTERRUPTED");

      const steered = await session.prompt("new-direction", 5_000);
      assert.equal(steered.status, "SUCCESS");
      assert.equal(steered.response, "Steered on conv-interrupt-1");
      assert.equal(steered.cumulativeUsage?.turnsCompleted, 1);
    } finally {
      await session.close();
    }
  });

  it("deduplicates image-generator subagent updates and tracks generated media paths", async () => {
    const directory = join(tmpdir(), `media-agy-${process.pid}`);
    mkdirSync(directory, { recursive: true });
    const binary = join(directory, "agy");
    writeFileSync(binary, `#!/usr/bin/env node
const readline = require('node:readline');
console.log(JSON.stringify({event:'init',conversation_id:'conv-media-1'}));
readline.createInterface({input:process.stdin}).on('line', () => {
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:2,state:'ACTIVE',step_type:'subagent',tool_name:'invoke_subagent',subagent_info:{subagents:[{type_name:'image-generator',role:'Image Generator',initial_prompt:'Generate rocket icon'}]}}}));
  console.log(JSON.stringify({event:'step_update',step_update:{step_index:2,state:'DONE',step_type:'subagent',tool_name:'invoke_subagent',duration_seconds:0.02,subagent_info:{subagents:[{type_name:'image-generator',role:'Image Generator',initial_prompt:'Generate rocket icon',conversation_id:'sub-img-1'}]}}}));
  console.log(JSON.stringify({event:'result',result:{conversation_id:'conv-media-1',status:'SUCCESS',response:'Saved icon at /tmp/generated_rocket.png and video at file:///tmp/demo_capture.webm.'}}));
});`);
    chmodSync(binary, 0o755);
    const session = new AgySession(binary, { cwd: process.cwd(), mode: "auto", sandbox: false, skipPermissions: true }, () => {});
    try {
      const result = await session.prompt("generate media", 5_000);
      assert.equal(result.status, "SUCCESS");
      assert.equal(result.subagents.length, 1);
      assert.equal(result.subagents[0]?.conversation_id, "sub-img-1");
      assert.deepEqual(result.workspaceActivity?.mediaGenerated, [
        "/tmp/generated_rocket.png",
        "/tmp/demo_capture.webm"
      ]);
      assert.ok((result.events ?? []).some((e) => e.toolName === "invoke_subagent" && e.target === "Image Generator (image-generator)"));
    } finally {
      await session.close();
    }
  });
});
