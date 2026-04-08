---
phase: 260408-hme
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/cli/index.ts
  - src/phase-runner/substeps/design.ts
  - src/cli/index.test.ts
autonomous: true
requirements: [CLI-01]

must_haves:
  truths:
    - "forge init skips requirements gathering when stdin is not a TTY"
    - "forge init skips design selection when stdin is not a TTY"
    - "forge init does not overwrite an existing REQUIREMENTS.md with a stub"
    - "re-running forge init on an initialized project resumes from roadmap generation"
  artifacts:
    - path: "src/cli/index.ts"
      provides: "TTY guard + existing-requirements guard in forge init"
    - path: "src/phase-runner/substeps/design.ts"
      provides: "TTY guard in runDesignSelection"
  key_links:
    - from: "src/cli/index.ts"
      to: "gatherRequirements"
      via: "process.stdin.isTTY check before call"
    - from: "src/phase-runner/substeps/design.ts"
      to: "promptUser"
      via: "process.stdin.isTTY check before readline"
---

<objective>
Fix two forge init bugs: (1) interactive prompts block non-interactive/background runs because there is no TTY guard, (2) re-running forge init silently overwrites a good REQUIREMENTS.md with a new stub.

Purpose: Forge is often invoked programmatically (CI, background agents). Both bugs cause hangs or data loss in that context.
Output: TTY detection added to requirements gathering and design selection; existing-requirements guard added to forge init.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/cli/index.ts
@src/phase-runner/substeps/design.ts
@src/cli/index.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add TTY guard and existing-requirements guard to forge init</name>
  <files>src/cli/index.ts, src/phase-runner/substeps/design.ts, src/cli/index.test.ts</files>
  <behavior>
    - Test: when process.stdin.isTTY is false and REQUIREMENTS.md does not exist, gatherRequirements is NOT called; init prints "[forge] Non-interactive mode — skipping requirements gathering."
    - Test: when process.stdin.isTTY is true and REQUIREMENTS.md does not exist, gatherRequirements IS called (existing behavior)
    - Test: when REQUIREMENTS.md already exists (any content), gatherRequirements is NOT called; init prints "[forge] REQUIREMENTS.md already exists — skipping requirements gathering." and proceeds to roadmap generation
    - Test: when process.stdin.isTTY is false, runDesignSelection is NOT called (skipped silently or with a single log line)
    - Test: when process.stdin.isTTY is false inside runDesignSelection itself, promptUser is never reached; function returns false immediately
  </behavior>
  <action>
    In `src/cli/index.ts` — `forge init` action, before the `gatherRequirements` call (around line 222):

    1. Add existing-requirements guard FIRST:
       ```typescript
       if (fs.existsSync("REQUIREMENTS.md")) {
         console.log("[forge] REQUIREMENTS.md already exists — skipping requirements gathering.");
       } else if (!process.stdin.isTTY) {
         console.log("[forge] Non-interactive mode — skipping requirements gathering.");
       } else {
         // existing gatherRequirements try/catch block
       }
       ```
       The gatherResult assignment must still be attempted from an existing file if present (for TEST_GUIDE.md downstream). After the guard block, if gatherResult is still undefined but REQUIREMENTS.md exists, parse it minimally or leave gatherResult undefined — the downstream `createTestGuide` already handles the undefined case.

    2. Around lines 248-259, the design selection block — wrap with an additional TTY check:
       ```typescript
       if (isGui && config.frontend?.designInteractive !== false && process.stdin.isTTY) {
       ```
       Remove the old condition `config.frontend?.designInteractive !== false` only from this outer check if TTY replaces it, but keep `designInteractive` config flag working in conjunction: skip if either `!process.stdin.isTTY` OR `designInteractive === false`.

    In `src/phase-runner/substeps/design.ts` — `runDesignSelection` function, add TTY guard at the very top (after the existing DESIGN.md check, around line 53):
    ```typescript
    if (!process.stdin.isTTY) {
      console.log("[forge] Non-interactive mode — skipping design selection.");
      return false;
    }
    ```
    This provides a second safety layer so that if `runDesignSelection` is ever called directly from other paths, it still won't hang.

    In `src/cli/index.test.ts` — add a new `describe("forge init TTY and re-init guards")` block mocking `process.stdin.isTTY` and `fs.existsSync`/`fs.readFileSync` to cover the four behavior cases listed above. Follow existing mock patterns (vi.mock for modules, vi.spyOn for process properties). Mock `gatherRequirements` to track call count.
  </action>
  <verify>
    <automated>npx vitest run src/cli/index.test.ts --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    All existing tests pass. New tests pass. forge init: (a) skips gathering if REQUIREMENTS.md exists, (b) skips gathering and design if stdin is not a TTY, (c) runs normally when TTY and no existing REQUIREMENTS.md.
  </done>
</task>

</tasks>

<verification>
npx vitest run src/cli/index.test.ts src/phase-runner/substeps/design.test.ts 2>&1 | tail -20
npx tsc --noEmit 2>&1 | head -20
</verification>

<success_criteria>
- `npx vitest run` passes with zero failures
- `npx tsc --noEmit` reports no type errors in modified files
- forge init called with a non-TTY stdin (e.g. `echo "" | forge init`) completes without hanging
- forge init called in a directory with an existing REQUIREMENTS.md does not overwrite it
</success_criteria>

<output>
After completion, create `.planning/quick/260408-hme-fix-forge-init-bugs-tty-detection-for-de/260408-hme-SUMMARY.md`
</output>
