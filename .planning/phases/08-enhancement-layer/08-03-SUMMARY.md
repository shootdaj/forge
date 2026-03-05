---
phase: 08-enhancement-layer
plan: 03
subsystem: testing
tags: [uat, docker, acceptance-testing, workflow-extraction, safety-guardrails]

# Dependency graph
requires:
  - phase: 03-step-runner
    provides: runStep primitive for executing UAT test steps
  - phase: 02-foundation
    provides: ForgeConfig and StateManager for context injection
provides:
  - UAT runner (runUAT) orchestrating full acceptance testing lifecycle
  - Workflow extraction from REQUIREMENTS.md acceptance criteria
  - App type detection (web/api/cli) from config stack
  - Docker-based application lifecycle (start/stop/health check)
  - Safety guardrails preventing production credential usage
  - Gap closure integration for failed workflow retry
affects: [08-04-integration-tests, pipeline-controller]

# Tech tracking
tech-stack:
  added: []
  patterns: [injectable-runStepFn-DI, map-based-mock-fs, safety-prompt-builder]

key-files:
  created:
    - src/uat/types.ts
    - src/uat/runner.ts
    - src/uat/workflows.ts
    - src/uat/index.ts
    - src/uat/runner.test.ts
  modified: []

key-decisions:
  - "runStepFn injectable on UATContext for DI testing (same pattern as executeQueryFn on StepRunnerContext)"
  - "Workflow chunking at 5 steps per workflow to keep UAT prompts focused"
  - "Health check polling with 2s interval via injectable execFn (curl-based)"
  - "Gap closure uses ctx.runStepFn instead of dynamic import for testability"

patterns-established:
  - "Injectable runStepFn: ctx.runStepFn ?? defaultRunStep for mocking in tests"
  - "createMockRunStep helper: factory producing vi.fn that writes result files to mock fs"
  - "Safety prompt builder: pure function generating guardrail constraints for UAT prompts"

requirements-completed: [UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06]

# Metrics
duration: 9min
completed: 2026-03-05
---

# Phase 8 Plan 3: UAT Runner Summary

**UAT runner with Docker lifecycle, app-type-aware testing strategies (web/api/cli), safety guardrails, and gap closure retry loop -- 62 unit tests**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-05T16:10:42Z
- **Completed:** 2026-03-05T16:19:56Z
- **Tasks:** 2
- **Files created:** 5

## Accomplishments
- Full UAT module (src/uat/) with types, runner, workflow extraction, and public API
- App type detection maps config.testing.stack to web/api/cli testing strategies
- Safety guardrails enforce sandbox credentials, local SMTP, test DB, and mock OAuth
- Gap closure retries failed workflows up to maxRetries times with targeted fix steps
- 62 unit tests covering all functions, edge cases, and integration-style runUAT flow

## Task Commits

Each task was committed atomically:

1. **Task 1: Define UAT types and implement workflow extraction** - `a6a17ea` (feat)
2. **Task 2: Implement UAT runner, index, and unit tests** - `22016e6` (feat)

## Files Created/Modified
- `src/uat/types.ts` - UATWorkflow, UATResult, WorkflowResult, UATContext, SafetyConfig, AppType types
- `src/uat/workflows.ts` - extractUserWorkflows, buildSafetyPrompt, runUATGapClosure
- `src/uat/runner.ts` - detectAppType, startApplication, stopApplication, waitForHealth, buildUATPrompt, verifyUATResults, runUAT
- `src/uat/index.ts` - Public API re-exporting all types and functions
- `src/uat/runner.test.ts` - 62 unit tests (977 lines) covering all UAT functions

## Decisions Made
- Added `runStepFn` injectable to UATContext for DI testing pattern (consistent with executeQueryFn pattern from StepRunnerContext). This avoids vi.doMock complexity and enables clean dependency injection in tests.
- Workflow extraction chunks requirements with >5 acceptance criteria into multiple UAT workflows (5 steps per chunk) to keep individual test prompts focused and manageable.
- Health check polling uses injectable execFn running `curl -sf {url}` with 2s interval, enabling fast test execution with mock.
- Gap closure in workflows.ts uses `ctx.runStepFn ?? defaultRunStep` instead of dynamic `import()` for testability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added runStepFn injectable to UATContext**
- **Found during:** Task 2 (unit tests for runUAT)
- **Issue:** vi.doMock for step-runner module didn't work because runner.ts statically imports runStep. Tests using vi.doMock returned stale module references, causing test failures and a 28s health check timeout.
- **Fix:** Added `runStepFn` field to UATContext interface (same DI pattern as `executeQueryFn` on StepRunnerContext). Updated runner.ts and workflows.ts to use `ctx.runStepFn ?? defaultRunStep`.
- **Files modified:** src/uat/types.ts, src/uat/runner.ts, src/uat/workflows.ts
- **Verification:** All 62 tests pass in 119ms (down from 28s)
- **Committed in:** 22016e6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** DI pattern is consistent with existing codebase conventions. No scope creep.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UAT module complete and tested, ready for pipeline integration in Plan 08-04
- All exported functions available via src/uat/index.ts
- runUAT integrates with pipeline controller's UAT state via PipelineContext

## Self-Check: PASSED

All files verified present:
- src/uat/types.ts
- src/uat/runner.ts
- src/uat/workflows.ts
- src/uat/index.ts
- src/uat/runner.test.ts

All commits verified:
- a6a17ea: feat(08-03): define UAT types and implement workflow extraction
- 22016e6: feat(08-03): implement UAT runner, index, and 62 unit tests

---
*Phase: 08-enhancement-layer*
*Completed: 2026-03-05*
