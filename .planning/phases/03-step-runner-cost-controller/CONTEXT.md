# Phase 3: Step Runner + Cost Controller - Context

**Phase:** 3
**Title:** Step Runner + Cost Controller
**Goal:** System can execute individual Agent SDK query() calls with budget enforcement, cost tracking, error handling, and automatic retry cascade
**Depends on:** Phase 2 (Config + State - completed)
**Requirements:** STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06, COST-01, COST-02, COST-03, COST-04

## Decisions

### D1: Step Runner Architecture
- `runStep()` is a function, not a class. It takes a step name, options, and dependencies (config, state manager, executeQuery).
- It wraps `executeQuery()` from Phase 1's SDK module, adding budget enforcement, cost tracking, and verification.
- Returns a discriminated union `StepResult` with status: "verified" | "failed" | "skipped" | "error".

### D2: Cost Tracking Granularity
- Per-step cost: extracted from `QueryResult.cost.totalCostUsd`
- Per-phase cost: sum of steps within a phase (tracked in state `phases[N].budgetUsed`)
- Project total: `state.totalBudgetUsed` (cumulative across all steps)
- Cost log: array of `CostLogEntry` objects per step, queryable by step name or phase

### D3: Budget Enforcement Strategy
- **Pre-step check**: Compare `state.totalBudgetUsed` against `config.maxBudgetTotal`. If exceeded, throw `BudgetExceededError` (hard stop).
- **Per-step cap**: Pass `config.maxBudgetPerStep` as `maxBudgetUsd` to the SDK query. SDK enforces this limit.
- **Budget exceeded mid-step**: SDK returns `budget_exceeded` error category. Treat as partial completion -- run verification callback to check what got done.

### D4: Error Classification for Retry
- **SDK errors** (network, auth): NOT retried. These are infrastructure problems, not logic problems. Return immediately with `sdkError: true`.
- **Step failures** (verification failed, execution error, budget exceeded): Eligible for retry via cascade.
- **Budget exceeded (project)**: Never retried. Hard stop.

### D5: Cascade Retry Strategy
- `runStepWithCascade()` wraps `runStep()` with a 3-tier failure cascade:
  - **Tier 1**: Retry up to 3 times. Each retry includes all prior error context in the prompt. Retries use a prompt builder that can modify the approach.
  - **Tier 2**: Skip and flag. Record what was tried, mark as skipped.
  - **Tier 3**: Stop. Only if the caller signals the step is critical (non-skippable).
- The cascade function takes an `onFailure` callback that decides retry strategy per attempt.

### D6: Dependency Injection
- `runStep()` and `runStepWithCascade()` accept their dependencies (config, stateManager, executeQuery) via a context object.
- This enables testing with mocked executeQuery (no real SDK calls).
- The context pattern matches Phase 1's executeQuery queryFn injection pattern.

## Gray Areas Resolved

1. **Should cost tracking be in state or separate?** Decision: Both. Cost log entries are in-memory during execution and written to state after each step via stateManager.update(). The state's `totalBudgetUsed` is the source of truth.

2. **Should runStep return partial results on budget exceeded?** Decision: Yes. When the SDK returns `budget_exceeded`, runStep still runs the verification callback. If verification passes, the step is "verified" despite the budget error. If it fails, the step is "failed" with `mayHavePartialWork: true`.

3. **How to pass error context to retry prompts?** Decision: The cascade maintains an `attempts` array with `{ approach, error, prompt }` for each failed attempt. The `onFailure` callback receives this history and returns either a new prompt or a skip/stop decision.

## Dependencies on Prior Phases

- **Phase 1 (SDK)**: `executeQuery()`, `QueryResult`, `SDKErrorCategory`, `CostData` types
- **Phase 2 (Config)**: `ForgeConfig` with `maxBudgetTotal`, `maxBudgetPerStep`, `maxTurnsPerStep`, `maxRetries`, `model`
- **Phase 2 (State)**: `StateManager` with `update()`, `ForgeState` with `totalBudgetUsed`, phase budget tracking

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping
