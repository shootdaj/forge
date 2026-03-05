---
phase: 06-pipeline-controller
plan: 03
subsystem: pipeline
tags: [pipeline-fsm, wave-model, orchestrator, checkpoint-resume, uat-gate, milestone]

# Dependency graph
requires:
  - phase: 06-pipeline-controller/01
    provides: PipelineContext, PipelineResult, WaveResult, dependency graph, MockManager
  - phase: 06-pipeline-controller/02
    provides: Human checkpoint, spec compliance loop, prompt builders
  - phase: 05-phase-runner
    provides: PhaseRunnerContext, PhaseResult, RunPhaseOptions, runPhase
  - phase: 03-step-runner
    provides: StepRunnerContext, StepResult, CostController, runStep
  - phase: 02-foundation
    provides: StateManager, ForgeState, ForgeConfig
provides:
  - runPipeline() FSM orchestrating full wave model (Wave 1 -> checkpoint -> Wave 2 -> Wave 3+ -> UAT -> milestone)
  - createTestPipelineContext() test factory for pipeline integration/scenario tests
affects: [06-04, 07-cli]

# Tech tracking
tech-stack:
  added: []
  patterns: [fsm-wave-model, safe-state-updates, resume-from-checkpoint, injectable-phase-runner]

key-files:
  created:
    - src/pipeline/pipeline-controller.ts
    - src/pipeline/pipeline-controller.test.ts
  modified:
    - src/pipeline/index.ts

key-decisions:
  - "Pipeline controller is a linear FSM with clear wave boundaries -- no complex branching or concurrent execution in v1"
  - "buildPhaseRunnerCtx() converts PipelineContext to PhaseRunnerContext for clean dependency injection"
  - "State updates wrapped in safeUpdateState() -- failures are non-critical and silently caught"
  - "Wave 1 failure of individual phases does not halt the wave -- all phases are attempted (dependent phases still run)"
  - "Mock runPhaseFn in tests also updates state.phases to simulate real phase runner behavior"
  - "UAT retry loop uses maxRetries from config with gap closure between attempts"

patterns-established:
  - "Pipeline FSM pattern: linear state transitions at wave boundaries with early return on failure/checkpoint"
  - "Safe state update pattern: try/catch wrapper that silently ignores failures for non-critical state mutations"
  - "createTestPipelineContext pattern: comprehensive test factory with in-memory state, fs, tracked calls for all pipeline tests"

requirements-completed: [PIPE-01, PIPE-05, PIPE-06, PIPE-09, PIPE-10]

# Metrics
duration: 5min
completed: 2026-03-05
---

# Phase 6 Plan 03: Pipeline Controller FSM Summary

**runPipeline() FSM orchestrating Wave 1 mocks, human checkpoint pause/resume, Wave 2 real integrations, Wave 3+ spec compliance, UAT gate with retry, and milestone audit/completion**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-05T14:54:57Z
- **Completed:** 2026-03-05T15:00:20Z
- **Tasks:** 2
- **Files created:** 2, modified: 1

## Accomplishments
- Pipeline controller FSM implementing the full SPEC.md wave model: initialization, Wave 1 (build with mocks), human checkpoint, Wave 2 (real integrations + skipped items), Wave 3+ (spec compliance), UAT gate, milestone completion
- 30 unit tests covering all FSM states, wave transitions, checkpoint logic, mock swapping, compliance delegation, UAT retry, milestone steps, error handling, and edge cases
- createTestPipelineContext() test factory with in-memory state manager, filesystem, tracked runPhaseFn/runStep calls, and configurable behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1: Pipeline controller FSM** - `ea4a5d9` (feat)
2. **Task 2: Pipeline controller unit tests + index export** - `18c0e91` (feat)

## Files Created/Modified
- `src/pipeline/pipeline-controller.ts` - Main runPipeline() FSM with Wave 1-4 execution, checkpoint pause/resume, error handling, and helper functions
- `src/pipeline/pipeline-controller.test.ts` - 30 unit tests across 7 describe blocks covering all FSM paths
- `src/pipeline/index.ts` - Added runPipeline export to pipeline module public API

## Decisions Made
- Pipeline controller is a linear FSM with clear wave boundaries -- no concurrent execution in v1 (graph supports it but sequential is simpler and debuggable)
- buildPhaseRunnerCtx() converts PipelineContext to PhaseRunnerContext for clean DI boundary between pipeline and phase runner
- All state updates use safeUpdateState() with try/catch -- failures are non-critical and never block pipeline progress
- Wave 1 phase failures don't halt the wave -- all phases are attempted so services and skipped items are fully collected before checkpoint
- UAT retry uses config.maxRetries with targeted gap closure between attempts
- Test mock runPhaseFn updates state.phases to simulate real phase runner behavior (critical for getCompletedPhaseNumbers assertions)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SpecComplianceResult shape in already-completed return**
- **Found during:** Task 1 (type checking)
- **Issue:** When state.status is "completed", the returned specCompliance was using raw state fields that lack `converged` and `remainingGaps` properties
- **Fix:** Constructed proper SpecComplianceResult with converged=true and remainingGaps from state
- **Files modified:** src/pipeline/pipeline-controller.ts
- **Committed in:** ea4a5d9 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type safety fix required for compilation. No scope creep.

## Issues Encountered
- Test helper double-tracked runPhaseFn calls (both wrapper and default pushed to array) -- fixed by removing push from default
- executeQueryBehavior override didn't track stepCalls -- fixed by wrapping all queries with tracking layer
- Mock runPhaseFn didn't update state.phases causing getCompletedPhaseNumbers to return empty -- fixed by having mock simulate state updates

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- runPipeline() ready for composition in Plan 04 (integration/scenario tests) and Phase 7 (CLI)
- createTestPipelineContext() factory ready for reuse in Plan 04 integration tests
- All pipeline modules (types, dependency graph, mock manager, checkpoint, compliance, prompts, controller) now complete and exported
- Full pipeline module API available via `src/pipeline/index.ts`

## Self-Check: PASSED

- All 3 files verified present on disk
- Both task commits (ea4a5d9, 18c0e91) verified in git history
- 30/30 pipeline controller tests pass
- 97/97 total pipeline module tests pass
- TypeScript compiles without errors

---
*Phase: 06-pipeline-controller*
*Completed: 2026-03-05*
