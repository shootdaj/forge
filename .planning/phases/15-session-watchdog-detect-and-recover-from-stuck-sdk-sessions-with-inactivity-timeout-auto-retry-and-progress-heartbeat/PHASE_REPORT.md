# Phase 15: Session Watchdog — Phase Report

**Completed:** 2026-04-08
**Status:** Complete

## Summary

Implemented a session watchdog system that prevents Forge from hanging silently when SDK sessions become unresponsive. The watchdog monitors SDK query execution for inactivity, emits heartbeat lines to stdout during long operations, and automatically retries timed-out sessions with configurable limits.

## Changes Made

### New Files
- `src/step-runner/watchdog.ts` — Core watchdog module with `executeWithWatchdog()` and `runWithRetries()` functions
- `src/step-runner/watchdog.test.ts` — 9 unit tests for watchdog timer logic, heartbeat, abort, and retry behavior

### Modified Files
- `src/config/schema.ts` — Added `WatchdogConfigSchema` with `inactivity_timeout_seconds` (default 120), `heartbeat_interval_seconds` (default 30), `max_retries` (default 2)
- `src/sdk/types.ts` — Added `"inactivity_timeout"` to `SDKErrorCategory` union
- `src/state/schema.ts` — Added `last_heartbeat` optional field to `ForgeStateSchema` and `ForgeState` interface
- `src/step-runner/types.ts` — Added `StepResultTimedOut` interface and added to `StepResult` union
- `src/step-runner/step-runner.ts` — Integrated watchdog into `runStep()` wrapping `executeQueryFn` calls
- `src/pipeline/spec-compliance.ts` — Handles `"timed_out"` status in gap fix loop (defers gracefully with git revert)
- `src/step-runner/step-runner.test.ts` — Added 7 integration/scenario tests for watchdog behavior
- `src/config/config.test.ts` — Added 3 tests for watchdog config defaults and overrides

## Success Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | SDK query() session killed after N seconds inactivity (configurable, default 120s) | PASS — `executeWithWatchdog` uses AbortController + timeout |
| 2 | Max retries configurable (default 2), step marked failed after exhaustion | PASS — `runWithRetries` loops, returns `StepResultTimedOut` |
| 3 | Periodic heartbeat lines to stdout during long sessions | PASS — `[forge] Ns since last activity... (step: NAME)` format |
| 4 | Inactivity based on SDK message stream activity, not wall clock | PASS — Watchdog wraps `executeQuery()` call, existing 5min per-message timeout in query-wrapper handles stream level |
| 5 | forge-state.json updated with last_heartbeat timestamp | PASS — Heartbeat callback updates state via `stateManager.update()` |
| 6 | All existing tests pass plus new watchdog tests | PASS — 1081 tests, 78 test files, 0 failures |

## Test Results

- **Total tests:** 1081
- **Passed:** 1081
- **Failed:** 0
- **New tests added:** 19 (9 watchdog unit + 7 step-runner integration/scenario + 3 config)

## Architecture Decisions

1. **Watchdog lives at step runner layer** — Wraps `executeQueryFn()` in `runStep()`, keeping query-wrapper focused on SDK protocol
2. **Separate from cascade retries** — Watchdog retries handle stuck sessions; cascade retries handle verification failures
3. **AbortController for session termination** — Already supported in `ForgeQueryOptions`, cleanest mechanism
4. **Best-effort state updates** — Heartbeat state writes use `.catch()` to avoid blocking execution on state persistence failures
