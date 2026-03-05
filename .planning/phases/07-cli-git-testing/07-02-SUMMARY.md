---
phase: 07-cli-git-testing
plan: 02
subsystem: cli
tags: [commander, cli, status-formatter, budget-display, plain-text]

# Dependency graph
requires:
  - phase: 07-cli-git-testing
    provides: "Git workflow utilities and testing infrastructure from Plan 01"
  - phase: 06-pipeline-controller
    provides: "Pipeline controller FSM, human checkpoint, spec compliance"
  - phase: 05-phase-runner
    provides: "Phase runner lifecycle with checkpoint resumability"
provides:
  - "CLI entry point with 5 commands (init, run, phase, status, resume)"
  - "Status formatter with budget breakdown display"
  - "PipelineResult/PhaseResult handler for terminal output"
affects: [07-03-integration-scenario-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Commander CLI with thin command handlers delegating to modules"
    - "Pure formatter functions for terminal display (no ANSI, no Unicode box drawing)"
    - "buildPipelineContext/buildStepRunnerContext helper functions for DI composition"

key-files:
  created:
    - src/cli/index.ts
    - src/cli/index.test.ts
    - src/cli/status.ts
    - src/cli/status.test.ts
  modified: []

key-decisions:
  - "Status formatter uses pure functions with no I/O -- formatStatus returns a string, console.log is only in CLI handlers"
  - "loadConfig is called with await even though it's synchronous -- future-proofs for async config sources"
  - "MockStateManagerClass pattern for vitest mocking of classes instantiated with new"
  - "buildPipelineContext shared between forge run and forge resume to avoid duplication"
  - "Budget breakdown defaults to $200.00 max when config is not loadable"

patterns-established:
  - "CLI command handler pattern: load config -> create state manager -> build context -> delegate to module -> handle result"
  - "PipelineResult/PhaseResult switch-on-status pattern for terminal output with exit codes"
  - "Class mock pattern: vi.mock with actual class definition (not vi.fn) for constructor-based dependencies"

requirements-completed: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, COST-05]

# Metrics
duration: 4min
completed: 2026-03-05
---

# Phase 7 Plan 02: CLI Commands & Status Formatter Summary

**Commander CLI with 5 commands (init/run/phase/status/resume) composing pipeline, phase-runner, config, and state modules with plain-text status display and per-phase budget breakdown**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-05T15:39:32Z
- **Completed:** 2026-03-05T15:44:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CLI entry point with 5 commands wired to all existing modules (pipeline, phase-runner, config, state, SDK)
- Status formatter producing 6-section plain text display (header, phases, services, skipped, compliance, budget)
- 26 new unit tests (15 status + 11 CLI wiring), all passing
- TypeScript compiles clean with --noEmit

## Task Commits

Each task was committed atomically:

1. **Task 1: Status formatter with unit tests** - `f988823` (feat)
2. **Task 2: CLI entry point with all five commands and unit tests** - `094e312` (feat)

## Files Created/Modified
- `src/cli/status.ts` - Pure formatting functions: formatStatus, formatPhaseTable, formatBudgetBreakdown, formatServicesNeeded, formatSkippedItems, formatSpecCompliance
- `src/cli/status.test.ts` - 15 unit tests covering all formatters with factory helper
- `src/cli/index.ts` - Commander CLI: createCli(), main(), command handlers for init/run/phase/status/resume
- `src/cli/index.test.ts` - 11 unit tests with full module mocking verifying command wiring and behavior

## Decisions Made
- Status formatter uses pure functions with no I/O -- formatStatus returns a string, console.log only in CLI handlers
- buildPipelineContext shared between forge run and forge resume to avoid duplication
- MockStateManagerClass pattern for vitest mocking -- vi.fn() does not create constructors, actual class needed
- Budget breakdown defaults to $200.00 max when config is not loadable (graceful fallback)
- loadConfig called with await even though synchronous -- future-proofs for async config

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test filter matching header line**
- **Found during:** Task 1 (Status formatter tests)
- **Issue:** Test filter `l.includes("Phase")` also matched "Phase Progress:" header, causing index mismatch
- **Fix:** Changed to regex filter `/Phase \d+:/` to match only numbered phase lines
- **Files modified:** src/cli/status.test.ts
- **Verification:** All 15 tests pass
- **Committed in:** f988823 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed StateManager mock not being a constructor**
- **Found during:** Task 2 (CLI unit tests)
- **Issue:** vi.fn(() => mockStateManager) fails when used with `new` -- "not a constructor" error
- **Fix:** Created MockStateManagerClass with the mock methods as instance properties
- **Files modified:** src/cli/index.test.ts
- **Verification:** All 11 tests pass
- **Committed in:** 094e312 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both were test issues, not production code. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 5 CLI commands wired and tested at unit level
- Status formatter ready for integration/scenario tests in Plan 03
- 70 total tests across all CLI module files (20 git + 24 traceability + 15 status + 11 CLI)
- Full module composition verified: CLI imports from pipeline, phase-runner, config, state, SDK, git, traceability

## Self-Check: PASSED

All 4 created files verified on disk. Both task commits (f988823, 094e312) verified in git log.

---
*Phase: 07-cli-git-testing*
*Completed: 2026-03-05*
