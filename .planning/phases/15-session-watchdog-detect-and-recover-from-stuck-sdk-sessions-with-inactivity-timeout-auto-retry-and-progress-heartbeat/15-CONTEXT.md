# Phase 15: Session Watchdog - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Forge never hangs silently. If an SDK query() session produces no output for a configurable timeout, it is killed and retried. Progress heartbeats show the user work is happening. This phase adds an inactivity-based watchdog to the step runner layer, configurable timeouts, auto-retry with max retry limits, and periodic heartbeat lines to stdout.

</domain>

<decisions>
## Implementation Decisions

### Timeout Architecture
- **D-01:** The watchdog lives in the step runner layer (`src/step-runner/step-runner.ts`), wrapping `executeQuery()` calls. The query-wrapper already has a low-level 5-minute inactivity timeout on the raw iterator — the step runner adds higher-level session watchdog behavior on top (kill + retry + heartbeat).
- **D-02:** The inactivity timeout is based on SDK message stream activity (tool calls, text output), not wall clock. A 10-minute active session is fine; 120s of silence triggers the watchdog.
- **D-03:** Default inactivity timeout is 120 seconds, configurable via `forge.config.json` field `watchdog.inactivity_timeout_seconds`.

### Heartbeat Output
- **D-04:** During long SDK sessions, Forge emits periodic heartbeat lines to stdout in the format: `[forge] Ns since last activity... (step: STEP_NAME)` — consistent with existing `[forge]` prefix pattern used by query-wrapper console.log lines.
- **D-05:** Heartbeat frequency: every 30 seconds of inactivity (configurable via `watchdog.heartbeat_interval_seconds`). Heartbeats start after the first 30s of silence, repeat every 30s until activity resumes or timeout is reached.

### Retry Behavior
- **D-06:** When timeout fires, the current session is killed (via AbortController) and retried with fresh context. The retry prompt includes a note that the previous attempt timed out, so the agent can try a different approach.
- **D-07:** Max retries per step is configurable (default 2) via `watchdog.max_retries`. After exhausting retries, the step is marked `failed` and pipeline continues.
- **D-08:** The watchdog retry is SEPARATE from the existing cascade retry mechanism. Watchdog retries handle stuck sessions; cascade retries handle verification failures.

### State Integration
- **D-09:** `forge-state.json` is updated with a `last_heartbeat` ISO timestamp whenever a heartbeat fires. This lets external monitoring tools detect if Forge itself is alive.

### Config Schema
- **D-10:** New `watchdog` section in `forge.config.json` schema with fields: `inactivity_timeout_seconds` (default 120), `heartbeat_interval_seconds` (default 30), `max_retries` (default 2).

### Error Handling
- **D-11:** Spec compliance (`src/pipeline/spec-compliance.ts`) should handle watchdog timeout errors gracefully — defer the gap and continue rather than crashing the loop.
- **D-12:** Timeout errors get a new SDKErrorCategory value `"inactivity_timeout"` so downstream code can distinguish them from other failures.

### Claude's Discretion
- Implementation details of the heartbeat timer mechanism (setInterval, setTimeout race, etc.)
- Exact wording of the retry prompt amendment
- Whether to use AbortController.abort() or process kill for session termination

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/sdk/query-wrapper.ts` -- Existing inactivity timeout on raw iterator (line 265-276), processQueryMessages function
- `src/sdk/types.ts` -- SDKErrorCategory type, ForgeQueryOptions (has abortController field)
- `src/step-runner/step-runner.ts` -- runStep() function where watchdog wraps executeQuery
- `src/step-runner/types.ts` -- StepResult types, StepRunnerContext, StepOptions
- `src/config/schema.ts` -- ForgeConfigSchema, ForgeConfig interface
- `src/state/schema.ts` -- ForgeStateSchema, ForgeState interface
- `src/pipeline/spec-compliance.ts` -- runIncrementalComplianceLoop, handles step failures

### Test Files
- `src/step-runner/step-runner.test.ts` -- Existing step runner tests (pattern to follow)
- `src/sdk/query-wrapper.test.ts` -- Existing query wrapper tests
- `src/pipeline/spec-compliance.test.ts` -- Existing spec compliance tests

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AbortController` support already wired into `ForgeQueryOptions` and `buildSDKOptions()` — can be used to kill stuck sessions
- `processQueryMessages()` already has a 5-minute inactivity timeout via Promise.race (lines 270-276 of query-wrapper.ts) — the watchdog builds on this pattern
- `CostController.recordStepCost()` — already tracks step costs even on failure, will work with watchdog retries

### Established Patterns
- Console output uses `[forge]` prefix for all user-facing messages (query-wrapper.ts lines 297-305)
- Step results use discriminated union pattern (`StepResult` type) with `status` field
- Config uses Zod schemas with `z.any().default({}).pipe()` pattern for nested defaults
- State schema uses snake_case JSON mapped to camelCase TypeScript via serialization layer

### Integration Points
- `runStep()` in step-runner.ts is where the watchdog wraps — between budget check and executeQuery call
- `ForgeConfig` interface needs new `watchdog` section
- `ForgeState` interface needs new `lastHeartbeat` field
- `SDKErrorCategory` type needs new `"inactivity_timeout"` variant
- `spec-compliance.ts` `runIncrementalComplianceLoop` calls `runStep` — will inherit watchdog behavior automatically

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches for timer/watchdog implementation.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 15-session-watchdog*
*Context gathered: 2026-04-08*
