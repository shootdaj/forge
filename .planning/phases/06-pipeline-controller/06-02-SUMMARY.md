---
phase: 06-pipeline-controller
plan: 02
subsystem: pipeline
tags: [human-checkpoint, spec-compliance, convergence, prompt-builders, resume-data]

# Dependency graph
requires:
  - phase: 06-pipeline-controller/01
    provides: PipelineContext, CheckpointReport, SpecComplianceResult, ServiceDetection, SkippedItem types
  - phase: 03-step-runner
    provides: runStep, StepRunnerContext, CostController
  - phase: 02-foundation
    provides: StateManager, ForgeState, ForgeConfig
provides:
  - Human checkpoint module (report generation, display formatting, file write, resume parsing)
  - Spec compliance loop with convergence checking (verify-fix-converge)
  - Pipeline prompt builders (new-project, scaffold, integration, skipped-item, compliance-gap)
  - needsHumanCheckpoint detection function
affects: [06-03, 06-04, 07-cli]

# Tech tracking
tech-stack:
  added: []
  patterns: [checkpoint-pause-resume, convergence-detection, env-file-parsing, prompt-builder-pure-functions]

key-files:
  created:
    - src/pipeline/human-checkpoint.ts
    - src/pipeline/human-checkpoint.test.ts
    - src/pipeline/spec-compliance.ts
    - src/pipeline/spec-compliance.test.ts
    - src/pipeline/prompts.ts
    - src/pipeline/prompts.test.ts
  modified:
    - src/pipeline/index.ts

key-decisions:
  - "Checkpoint display uses plain text formatting (no Unicode box drawing) for terminal compatibility"
  - "Env file parser handles single/double quoted values and strips surrounding quotes"
  - "Guidance file parsed by ## RequirementID headers into Record<string, string>"
  - "First compliance round always proceeds (converging vs baseline) -- convergence check only applies from round 2+"
  - "State update failures in compliance loop are caught and silenced -- non-critical for loop progress"
  - "verifyRequirement uses outputSchema for structured { passed, gapDescription } extraction"

patterns-established:
  - "Checkpoint pause/resume pattern: writeCheckpointFile + loadResumeData for env/guidance parsing"
  - "Convergence detection: gapHistory array with strictly-decreasing check (stuck = same count, worsening = increased count)"
  - "Prompt builders are pure functions (data in, string out) -- same pattern as phase-runner prompts"

requirements-completed: [PIPE-04, PIPE-07, PIPE-08]

# Metrics
duration: 6min
completed: 2026-03-05
---

# Phase 6 Plan 02: Human Checkpoint, Spec Compliance, and Prompt Builders Summary

**Human checkpoint with batched pause/resume, spec compliance loop with convergence detection, and 5 pipeline prompt builders for Wave 1-3 agent steps**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-05T14:43:19Z
- **Completed:** 2026-03-05T14:50:14Z
- **Tasks:** 2
- **Files created:** 6, modified: 1

## Accomplishments
- Human checkpoint module: generates reports from state, formats terminal display, writes JSON checkpoint file, parses env+guidance resume data
- Spec compliance loop: verifies each requirement via structured output, fixes gaps iteratively, checks convergence (gaps must decrease), stops if stuck
- Pipeline prompt builders: 5 pure functions for new-project, scaffold, integration, skipped-item, and compliance-gap prompts
- 35 unit tests across 3 test files (21 checkpoint/prompts + 14 compliance)

## Task Commits

Each task was committed atomically:

1. **Task 1: Human checkpoint and prompt builders** - `8328ed5` (feat)
2. **Task 2: Spec compliance loop with convergence checking** - `a5ff3f4` (feat)

## Files Created/Modified
- `src/pipeline/human-checkpoint.ts` - Checkpoint report generation, display formatting, file write, resume data parsing, needs-checkpoint detection
- `src/pipeline/human-checkpoint.test.ts` - 21 unit tests for all checkpoint functions
- `src/pipeline/spec-compliance.ts` - Convergence checking, requirement verification, compliance loop
- `src/pipeline/spec-compliance.test.ts` - 14 unit tests for convergence, verification, and loop scenarios
- `src/pipeline/prompts.ts` - 5 prompt builder functions for pipeline agent steps
- `src/pipeline/prompts.test.ts` - 9 unit tests (added 2 extra edge case tests) for all prompt builders
- `src/pipeline/index.ts` - Updated with exports for human-checkpoint, spec-compliance, and prompts modules

## Decisions Made
- Checkpoint display uses plain text formatting (no Unicode box drawing) for maximum terminal compatibility
- Env file parser handles both single and double quoted values, stripping surrounding quotes
- Guidance file parsed by `## RequirementID` headers into a Record -- simple and predictable format
- First compliance round always proceeds vs baseline; convergence check applies from round 2+ only
- State update failures in the compliance loop are caught and silenced -- non-critical for loop progress (same pattern as phase runner)
- verifyRequirement uses outputSchema for structured `{ passed, gapDescription }` extraction from the agent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Human checkpoint, spec compliance, and prompt builders ready for composition in Plan 03 (pipeline controller FSM)
- All functions exported via `src/pipeline/index.ts`
- Checkpoint pause/resume provides the Wave 1 -> Wave 2 transition mechanism
- Spec compliance loop provides the Wave 3+ convergence mechanism
- Prompt builders provide all prompts needed by the pipeline controller's wave execution

## Self-Check: PASSED

- All 7 files verified present on disk (6 created + 1 modified)
- Both task commits (8328ed5, a5ff3f4) verified in git history
- 35/35 tests pass across 3 test files
- TypeScript compiles without errors

---
*Phase: 06-pipeline-controller*
*Completed: 2026-03-05*
