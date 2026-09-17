---
name: delegate-with-antigravity
description: Use Codex Antigravity when the codex-antigravity plugin is explicitly selected or when Antigravity analysis, planning, implementation, or validation is requested.
metadata:
  short-description: Delegate work to Antigravity
---

# Delegate with Codex Antigravity

When the `codex-antigravity` plugin is explicitly selected or tagged, Codex acts as the **Supervisor Agent** and delegates execution to Antigravity as an **Autonomous Coding Subagent**. The user's tag authorizes full inspection, programming, and terminal command execution inside the declared workspace.

### Supervised Development Workflow
1. **Initialize Session**:
   - For code implementation, feature development, bug fixing, refactoring, and git operations (switching branches, creating commits, running builds): start the session with `mode: "accept-edits"`, `cwd: <workspace>`, and `skipPermissions: true`.
   - For pure read-only architectural analysis, audits, and exploration: use `mode: "plan"`.
2. **Delegate Coding Task**:
   - Send the task description to `antigravity_session_prompt` (or `antigravity_run`).
   - For complex, multi-stage workflows (monorepos with multiple git projects, extensive builds, or large refactors), allocate adequate `timeoutMs` (e.g. 600,000ms / 10 min) or split the workflow into 2 supervised turns:
     - **Turn 1**: Code changes, tests, and build validation in the target subproject.
     - **Turn 2**: Git branch creation, commit, and final status report.
   - Antigravity detects sub-packages / nested git repositories automatically and executes commands within the target subproject.
3. **Supervise and Verify**:
   - Codex inspects the returned structured result payload (`tools` invoked, `subagents` launched, `response`, and `diagnostics`).
   - Even if a timeout occurs, Antigravity returns all partial streamed output and tools invoked up to that point.
   - If build/test errors are reported or if additional refinements are required, Codex sends a follow-up prompt in the active session to resolve them.
4. **Finalize**:
   - Close the session (`antigravity_session_close`) once the workflow is completed.
   - Present the structured outcome (files changed, git branch status, test execution results, and summary) directly to the user.
