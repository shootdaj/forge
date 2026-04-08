---
phase: 260408-hme
plan: "01"
subsystem: cli
tags: [bug-fix, tty-detection, forge-init, non-interactive]
dependency_graph:
  requires: []
  provides: [TTY guard in forge init, existing-requirements guard in forge init, TTY guard in runDesignSelection]
  affects: [src/cli/index.ts, src/phase-runner/substeps/design.ts]
tech_stack:
  added: []
  patterns: [process.stdin.isTTY guard, fs.existsSync pre-flight check]
key_files:
  created: []
  modified:
    - src/cli/index.ts
    - src/phase-runner/substeps/design.ts
    - src/cli/index.test.ts
decisions:
  - "Existing-requirements guard checked before TTY guard: re-init protection takes priority over interactivity"
  - "TTY guard added to both the forge init condition and inside runDesignSelection for defense-in-depth"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-08T05:45:01Z"
  tasks_completed: 1
  files_changed: 3
---

# Phase 260408-hme Plan 01: Fix Forge Init Bugs — TTY Detection and Re-init Guard Summary

**One-liner:** TTY detection and existing-REQUIREMENTS.md guard added to `forge init` and `runDesignSelection` to prevent hangs and data loss in non-interactive/CI contexts.

## What Was Built

Two bugs in `forge init` fixed:

1. **Re-init guard** (`src/cli/index.ts`): Before calling `gatherRequirements`, `forge init` now checks if `REQUIREMENTS.md` already exists. If it does, gathering is skipped with a log message and the flow proceeds to roadmap generation — preventing silent overwrite of user's requirements on re-run.

2. **TTY guard in `forge init`** (`src/cli/index.ts`): If `process.stdin.isTTY` is false (CI, background agent, pipe), `gatherRequirements` is skipped. The design selection condition also gained a `process.stdin.isTTY` check so `runDesignSelection` is never called in non-interactive mode.

3. **TTY guard in `runDesignSelection`** (`src/phase-runner/substeps/design.ts`): Added a second-layer guard at the top of the function (after the DESIGN.md existence check). If `process.stdin.isTTY` is false, the function returns `false` immediately without creating a readline interface — ensuring that any direct call path also can't hang.

## Tests Added

New `describe("forge init TTY and re-init guards")` block in `src/cli/index.test.ts` with 4 tests:

| Test | Behavior |
|------|----------|
| `TestForgeInit_SkipsGatheringWhenNonTTY` | `gatherRequirements` not called when `process.stdin.isTTY === false` |
| `TestForgeInit_CallsGatheringWhenTTYAndNoRequirementsFile` | `gatherRequirements` called when `isTTY === true` and no existing file |
| `TestForgeInit_SkipsGatheringWhenRequirementsFileAlreadyExists` | `gatherRequirements` not called when `REQUIREMENTS.md` exists |
| `TestForgeInit_SkipsDesignSelectionWhenNonTTY` | `runDesignSelection` not called in non-TTY mode for GUI apps |

**Test infrastructure added:** Mocks for `../requirements/index.js` (gatherRequirements), `../phase-runner/substeps/design.js` (runDesignSelection, detectGuiApp), and `node:fs` (existsSync, writeFileSync, mkdirSync, readFileSync).

## Commits

| Hash | Message |
|------|---------|
| `2a46e68` | `test(260408-hme-01): add failing tests for TTY and re-init guards in forge init` |
| `8652230` | `feat(260408-hme-01): add TTY guard and existing-requirements guard to forge init` |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/cli/index.ts` — modified (guards added)
- `src/phase-runner/substeps/design.ts` — modified (TTY guard added)
- `src/cli/index.test.ts` — modified (4 new tests)
- Commits `2a46e68` and `8652230` verified in git log
- `npx vitest run` — 15/15 tests pass, 0 failures
- `npx tsc --noEmit` — 0 type errors
