# Phase 3: Step Runner + Cost Controller - Plan

## Plan 03-01: Step Runner Core + Cost Controller

### Overview
Implement the core step execution primitive (`runStep()`) that wraps `executeQuery()` with budget enforcement, cost tracking, verification callbacks, and error handling. Implement the cost controller that tracks per-step, per-phase, and project-level budgets. Implement the failure cascade (`runStepWithCascade()`) for retry logic.

### Requirements Covered
- STEP-01: runStep() wrapper with budget enforcement and verification
- STEP-02: Budget hard-stop before each step
- STEP-03: Cost tracking per step via SDK's total_cost_usd
- STEP-04: runStepWithCascade() failure cascade (retry 3x, skip, stop)
- STEP-05: Partial completion handling on budget exceeded
- STEP-06: SDK errors not retried
- COST-01: Per-step budget via maxBudgetUsd
- COST-02: Total project budget hard stop
- COST-03: Per-phase budget tracked
- COST-04: Cost logged per step

### Tasks

#### Task 1: Step Runner Types (`src/step-runner/types.ts`)
- Define `StepOptions` interface (prompt, verify callback, maxBudgetUsd override, phase, outputSchema)
- Define `StepResult` discriminated union (verified/failed/skipped/error statuses)
- Define `StepContext` for dependency injection (config, stateManager, executeQueryFn)
- Define `CostLogEntry` for per-step cost tracking
- Define `CascadeOptions` for failure cascade configuration
- Define `CascadeResult` extending StepResult with attempts history
- Define `BudgetExceededError` custom error

#### Task 2: Cost Controller (`src/step-runner/cost-controller.ts`)
- Implement `checkBudget()` - pre-step budget check against project total
- Implement `recordStepCost()` - update state with step cost
- Implement `getCostLog()` - query cost entries by step name or phase
- Implement `getPhaseTotal()` - sum costs for a phase
- Cost log maintained in-memory with flush to state on each step completion

#### Task 3: Step Runner Core (`src/step-runner/step-runner.ts`)
- Implement `runStep()`:
  1. Check project budget (hard stop via COST-02)
  2. Call `executeQuery()` with per-step budget (COST-01)
  3. Handle SDK errors (STEP-06: network/auth not retried)
  4. Handle budget exceeded mid-step (STEP-05: run verification)
  5. Track cost (STEP-03, COST-04)
  6. Run verification callback (STEP-01)
  7. Update state with cost (COST-03)
  8. Return typed StepResult

#### Task 4: Failure Cascade (`src/step-runner/cascade.ts`)
- Implement `runStepWithCascade()`:
  1. Call `runStep()` - if passes, return
  2. On failure (not SDK error): retry up to maxRetries times
  3. Each retry includes prior error context in prompt
  4. After retries exhausted: skip and flag (add to skippedItems in state)
  5. If step is non-skippable: stop and report
  6. SDK errors bypass cascade entirely (STEP-06)

#### Task 5: Module Exports (`src/step-runner/index.ts`)
- Export all public APIs
- Re-export types

#### Task 6: Unit Tests (`src/step-runner/step-runner.test.ts`)
- TestRunStep_SuccessfulExecution_STEP01: mock executeQuery returns success, verify passes
- TestRunStep_VerificationFails_STEP01: mock executeQuery returns success, verify fails
- TestRunStep_BudgetHardStop_STEP02: totalBudgetUsed >= maxBudgetTotal
- TestRunStep_CostTracking_STEP03: verify cost extracted and accumulated
- TestRunStep_BudgetExceededMidStep_STEP05: SDK returns budget_exceeded, verify still runs
- TestRunStep_BudgetExceededMidStep_VerifyPasses_STEP05: partial work detected
- TestRunStep_SDKNetworkError_STEP06: not retried, returned as error
- TestRunStep_SDKAuthError_STEP06: not retried, returned as error
- TestRunStep_PerStepBudget_COST01: maxBudgetUsd passed to executeQuery
- TestRunStep_ProjectBudgetCheck_COST02: hard stop before starting
- TestRunStep_PhaseBudgetTracked_COST03: phase budget_used updated in state
- TestRunStep_CostLogged_COST04: cost log entry created

#### Task 7: Unit Tests - Cascade (`src/step-runner/cascade.test.ts`)
- TestRunStepWithCascade_FirstAttemptSucceeds_STEP04: no retries needed
- TestRunStepWithCascade_RetrySucceeds_STEP04: fails first, succeeds on retry
- TestRunStepWithCascade_AllRetriesFail_SkipAndFlag_STEP04: 3 retries then skip
- TestRunStepWithCascade_ErrorContextInRetry_STEP04: prior errors included in prompt
- TestRunStepWithCascade_SDKErrorNotRetried_STEP06: SDK error skips cascade
- TestRunStepWithCascade_NonSkippable_Stop_STEP04: non-skippable step stops
- TestRunStepWithCascade_SkippedItemRecorded_STEP04: skipped items added to state

#### Task 8: Unit Tests - Cost Controller (`src/step-runner/cost-controller.test.ts`)
- TestCheckBudget_UnderBudget_Passes_COST02
- TestCheckBudget_AtBudget_Throws_COST02
- TestCheckBudget_OverBudget_Throws_COST02
- TestRecordStepCost_UpdatesState_COST03
- TestRecordStepCost_AccumulatesTotal_COST04
- TestGetCostLog_QueryByStep_COST04
- TestGetCostLog_QueryByPhase_COST04
- TestGetPhaseTotal_SumsCorrectly_COST03

#### Task 9: Integration Tests (`test/integration/step-runner.test.ts`)
- TestIntegration_StepRunner_FullExecution: runStep with mock executeQuery, verify state updates
- TestIntegration_StepRunner_BudgetEnforcement: budget check + per-step budget passed through
- TestIntegration_CostController_StateIntegration: cost tracked across multiple steps
- TestIntegration_Cascade_RetryWithStateUpdates: cascade updates state correctly

#### Task 10: Scenario Tests (`test/scenarios/step-runner.test.ts`)
- TestScenario_StepExecution_BudgetEnforcement_CostTracking: full flow of step with budget
- TestScenario_CascadeFailure_RetryAndSkip: end-to-end cascade with skip
- TestScenario_MultiStepPhase_CostAccumulation: multiple steps, cost tracked per phase
- TestScenario_SDKError_NoRetry_ImmediateReturn: SDK error flows through correctly

### Success Criteria
1. runStep() wraps executeQuery(), enforces per-step budget, runs verification, returns typed output
2. System refuses to start step when total cost exceeds project budget (hard stop)
3. runStepWithCascade() retries up to 3 times with error context, then skips, then stops
4. Cost tracked per step and per phase, queryable
5. SDK errors (network, auth) not retried
