---
phase: 04-programmatic-verifiers
plan: 01
subsystem: verification
tags: [tsc, vitest, eslint, docker-compose, git-diff, child_process, zod]

# Dependency graph
requires:
  - phase: 02-foundation
    provides: ForgeConfig schema and loader with snake_case-to-camelCase mapping
provides:
  - Verifier type system (VerifierResult, VerifierConfig, Verifier, VerificationReport)
  - execWithTimeout utility for safe shell execution
  - 8 standalone verifier functions (files, tests, typecheck, lint, coverage, observability, docker, deployment)
  - Updated VerificationConfigSchema with 8 verifier toggles
affects: [04-programmatic-verifiers, 05-phase-runner]

# Tech tracking
tech-stack:
  added: []
  patterns: [verifier-function-pattern, skipped-result-pattern, exec-with-timeout]

key-files:
  created:
    - src/verifiers/types.ts
    - src/verifiers/utils.ts
    - src/verifiers/files.ts
    - src/verifiers/tests.ts
    - src/verifiers/typecheck.ts
    - src/verifiers/lint.ts
    - src/verifiers/coverage.ts
    - src/verifiers/observability.ts
    - src/verifiers/docker.ts
    - src/verifiers/deployment.ts
    - src/verifiers/files.test.ts
    - src/verifiers/tests.test.ts
    - src/verifiers/typecheck.test.ts
    - src/verifiers/lint.test.ts
    - src/verifiers/coverage.test.ts
    - src/verifiers/observability.test.ts
    - src/verifiers/docker.test.ts
    - src/verifiers/deployment.test.ts
  modified:
    - src/config/schema.ts
    - src/config/config.test.ts

key-decisions:
  - "Tests verifier uses temp file for JSON output to avoid stdout/stderr mixing (vitest pitfall)"
  - "Observability verifier only fails on missing health endpoint; logging checks are informational warnings"
  - "Deployment verifier env var consistency is informational (many vars are runtime-injected)"
  - "Coverage verifier checks 4 test file patterns: co-located .test, co-located .spec, separate test/, separate test/unit/"

patterns-established:
  - "Verifier function pattern: (config: VerifierConfig) => Promise<VerifierResult> - standalone, independently testable"
  - "Skip-not-fail pattern: skippedResult() returns passed=true with descriptive skip reason when prerequisites missing"
  - "execWithTimeout pattern: never throws, returns {stdout, stderr, exitCode} with 10MB buffer and ANSI suppression"

requirements-completed: [VER-01, VER-02, VER-03, VER-04, VER-05, VER-06, VER-07, VER-08]

# Metrics
duration: 7min
completed: 2026-03-05
---

# Phase 4 Plan 1: Programmatic Verifiers Summary

**8 standalone verifier functions (files, tests, typecheck, lint, coverage, observability, docker, deployment) with 41 unit tests, type system, and execWithTimeout utility**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-05T13:16:33Z
- **Completed:** 2026-03-05T13:23:14Z
- **Tasks:** 3
- **Files modified:** 20

## Accomplishments
- Complete verifier type system with VerifierResult, VerifierConfig, Verifier, VerificationReport interfaces and skippedResult helper
- execWithTimeout utility providing safe shell execution with 10MB buffer, ANSI suppression, and no-throw semantics
- 8 verifier functions covering all VER-01 through VER-08 requirements
- Updated VerificationConfigSchema with 8 toggles (files, tests, typecheck, lint true by default; docker, observability, deployment false by default)
- 41 unit tests with comprehensive pass/fail/skip/edge case coverage
- Full project test suite: 200/200 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Types, utils, and config schema update** - `87875cb` (feat)
2. **Task 2: Files, tests, typecheck, and lint verifiers with unit tests** - `9630b4e` (feat)
3. **Task 3: Coverage, observability, docker, and deployment verifiers with unit tests** - `2c60a26` (feat)

## Files Created/Modified
- `src/verifiers/types.ts` - VerifierResult, VerifierConfig, Verifier, VerificationReport interfaces; skippedResult helper
- `src/verifiers/utils.ts` - execWithTimeout utility for safe shell command execution
- `src/verifiers/files.ts` - VER-01: checks fs.existsSync for expected files
- `src/verifiers/tests.ts` - VER-02: runs test command, parses vitest/jest JSON via temp file
- `src/verifiers/typecheck.ts` - VER-03: runs tsc --noEmit, parses error patterns
- `src/verifiers/lint.ts` - VER-04: runs eslint, uses exit code as signal
- `src/verifiers/coverage.ts` - VER-05: git diff for new files, checks test file patterns
- `src/verifiers/observability.ts` - VER-06: three-check heuristic (health, logging, errors)
- `src/verifiers/docker.ts` - VER-07: docker compose up/down with finally cleanup
- `src/verifiers/deployment.ts` - VER-08: Dockerfile existence, env var consistency
- `src/verifiers/*.test.ts` - 41 unit tests across 8 test files
- `src/config/schema.ts` - Added files, tests, deployment toggles; changed docker/observability defaults to false
- `src/config/config.test.ts` - Updated full config test to cover new verification fields

## Decisions Made
- Tests verifier uses a temp file for JSON output rather than parsing stdout, avoiding the vitest stdout/stderr mixing pitfall documented in research
- Observability verifier only fails on missing health endpoint; structured logging and error logging checks are informational warnings (too heuristic to enforce)
- Deployment verifier treats env var consistency as informational (many vars are runtime-injected, not declared in Dockerfile)
- Coverage verifier checks 4 test file patterns in order: co-located .test, co-located .spec, separate test/ dir, separate test/unit/ dir

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added full config test coverage for new verification fields**
- **Found during:** Task 1
- **Issue:** Existing config test for full config didn't include the new `files`, `tests`, and `deployment` verification fields
- **Fix:** Updated TestLoadConfig_FullConfig_AllFieldsLoaded to include and assert all 8 verification toggles
- **Files modified:** src/config/config.test.ts
- **Verification:** 10/10 config tests passing
- **Committed in:** 87875cb (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for comprehensive test coverage. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 8 verifiers are standalone and independently testable
- Ready for Plan 02 which will wire verifiers into a registry with runAll() orchestration
- Phase 5 (Phase Runner) can consume verifiers via VerificationReport.passed

## Self-Check: PASSED

- All 19 files verified as existing on disk
- All 3 task commits verified in git history (87875cb, 9630b4e, 2c60a26)
- Full test suite: 200/200 passing
- TypeScript compilation: clean (0 errors)

---
*Phase: 04-programmatic-verifiers*
*Completed: 2026-03-05*
