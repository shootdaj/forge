/**
 * Step Runner
 *
 * The core execution primitive. Every runStep() call wraps a single
 * executeQuery() invocation with budget enforcement, cost tracking,
 * error handling, and verification.
 *
 * Requirements: STEP-01, STEP-02, STEP-03, STEP-05, STEP-06,
 *               COST-01, COST-02, COST-03, COST-04
 */

import type {
  StepOptions,
  StepResult,
  StepResultVerified,
  StepResultFailed,
  StepResultError,
  StepResultBudgetExceeded,
  StepRunnerContext,
} from "./types.js";
import { BudgetExceededError } from "./types.js";
import type { CostController } from "./cost-controller.js";

/**
 * Execute a single step: query the SDK, enforce budget, track cost, verify.
 *
 * This is the foundational primitive for all Forge execution.
 *
 * Flow:
 * 1. Check project budget (hard stop) -- STEP-02, COST-02
 * 2. Call executeQuery() with per-step budget -- COST-01
 * 3. Handle SDK errors (network/auth not retried) -- STEP-06
 * 4. Handle budget exceeded mid-step (run verification) -- STEP-05
 * 5. Track cost -- STEP-03, COST-03, COST-04
 * 6. Run verification callback -- STEP-01
 * 7. Update state with cost
 * 8. Return typed StepResult
 *
 * Requirements: STEP-01, STEP-02, STEP-03, STEP-05, STEP-06,
 *               COST-01, COST-02, COST-03, COST-04
 *
 * @param name - Step identifier for logging and cost tracking
 * @param opts - Step configuration including prompt and verify callback
 * @param ctx - Injected dependencies (config, stateManager, executeQuery)
 * @param costController - Cost controller for logging and budget checks
 */
export async function runStep(
  name: string,
  opts: StepOptions,
  ctx: StepRunnerContext,
  costController: CostController,
): Promise<StepResult> {
  const { config, stateManager, executeQueryFn } = ctx;

  // ─── 1. Pre-step budget check (hard stop) ───
  // STEP-02, COST-02: Refuse to start if project budget exceeded
  const currentState = stateManager.load();
  try {
    costController.checkBudget(
      currentState.totalBudgetUsed,
      config.maxBudgetTotal,
    );
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      const result: StepResultBudgetExceeded = {
        status: "budget_exceeded",
        costUsd: 0,
        totalBudgetUsed: err.totalBudgetUsed,
        maxBudgetTotal: err.maxBudgetTotal,
        error: err.message,
      };
      return result;
    }
    throw err;
  }

  // ─── 2. Execute query with per-step budget ───
  // COST-01: Per-step budget via maxBudgetUsd
  const queryResult = await executeQueryFn({
    prompt: opts.prompt,
    maxBudgetUsd: opts.maxBudgetUsd ?? config.maxBudgetPerStep,
    maxTurns: opts.maxTurns ?? config.maxTurnsPerStep,
    model: opts.model ?? config.model,
    cwd: opts.cwd,
    outputSchema: opts.outputSchema,
  });

  const stepCostUsd = queryResult.cost.totalCostUsd;

  // ─── 3. Handle SDK errors (STEP-06: not retried) ───
  if (!queryResult.ok) {
    const category = queryResult.error.category;

    // SDK infrastructure errors: network, auth -- do NOT retry
    if (category === "network" || category === "auth") {
      const errorResult: StepResultError = {
        status: "error",
        costUsd: stepCostUsd,
        costData: queryResult.cost,
        sdkErrorCategory: category,
        error: queryResult.error.message,
        sdkError: true,
        sessionId: queryResult.sessionId ?? undefined,
      };

      // Track cost even on SDK errors (money was spent)
      costController.recordStepCost(
        name,
        opts.phase,
        stepCostUsd,
        queryResult.cost,
        "error",
        queryResult.sessionId ?? undefined,
      );

      // Update state with cost
      await stateManager.update((state) => ({
        ...state,
        totalBudgetUsed: state.totalBudgetUsed + stepCostUsd,
      }));

      return errorResult;
    }

    // ─── 4. Budget exceeded mid-step (STEP-05) ───
    // SDK returned budget_exceeded -- run verification to check partial work
    if (category === "budget_exceeded") {
      // Track cost
      costController.recordStepCost(
        name,
        opts.phase,
        stepCostUsd,
        queryResult.cost,
        "failed",
        queryResult.sessionId ?? undefined,
      );

      // Update state with cost
      await stateManager.update((state) => ({
        ...state,
        totalBudgetUsed: state.totalBudgetUsed + stepCostUsd,
      }));

      // Run verification to see if partial work completed the goal
      let verified = false;
      try {
        verified = await opts.verify();
      } catch {
        verified = false;
      }

      if (verified) {
        return {
          status: "verified",
          costUsd: stepCostUsd,
          costData: queryResult.cost,
          result: "",
          structuredOutput: undefined,
          sessionId: queryResult.sessionId ?? "",
        } satisfies StepResultVerified;
      }

      return {
        status: "failed",
        costUsd: stepCostUsd,
        costData: queryResult.cost,
        mayHavePartialWork: true,
        error: `Per-step budget exceeded: ${queryResult.error.message}`,
        sessionId: queryResult.sessionId ?? undefined,
      } satisfies StepResultFailed;
    }

    // Other error types (execution_error, max_turns, etc.) -- treatable as failures
    costController.recordStepCost(
      name,
      opts.phase,
      stepCostUsd,
      queryResult.cost,
      "failed",
      queryResult.sessionId ?? undefined,
    );

    await stateManager.update((state) => ({
      ...state,
      totalBudgetUsed: state.totalBudgetUsed + stepCostUsd,
    }));

    return {
      status: "failed",
      costUsd: stepCostUsd,
      costData: queryResult.cost,
      mayHavePartialWork: queryResult.error.mayHavePartialWork,
      error: queryResult.error.message,
      sessionId: queryResult.sessionId ?? undefined,
    } satisfies StepResultFailed;
  }

  // ─── 5. Success path: track cost ───
  // STEP-03, COST-03, COST-04
  costController.recordStepCost(
    name,
    opts.phase,
    stepCostUsd,
    queryResult.cost,
    "verified", // tentative -- will update if verification fails
    queryResult.sessionId,
  );

  // Update state: accumulate total budget and phase budget
  await stateManager.update((state) => {
    const updated = {
      ...state,
      totalBudgetUsed: state.totalBudgetUsed + stepCostUsd,
    };

    // Update phase budget if a phase is specified
    if (opts.phase !== undefined) {
      const phaseKey = String(opts.phase);
      const existingPhase = updated.phases[phaseKey];
      if (existingPhase) {
        updated.phases = {
          ...updated.phases,
          [phaseKey]: {
            ...existingPhase,
            budgetUsed: existingPhase.budgetUsed + stepCostUsd,
          },
        };
      }
    }

    return updated;
  });

  // ─── 6. Run verification callback ───
  // STEP-01: Verification determines if the step succeeded
  let verified = false;
  try {
    verified = await opts.verify();
  } catch {
    verified = false;
  }

  if (verified) {
    return {
      status: "verified",
      costUsd: stepCostUsd,
      costData: queryResult.cost,
      result: queryResult.result,
      structuredOutput: queryResult.structuredOutput,
      sessionId: queryResult.sessionId,
    } satisfies StepResultVerified;
  }

  // Verification failed -- step completed but didn't achieve its goal
  return {
    status: "failed",
    costUsd: stepCostUsd,
    costData: queryResult.cost,
    mayHavePartialWork: true,
    error: "Step execution completed but verification failed",
    result: queryResult.result,
    sessionId: queryResult.sessionId,
  } satisfies StepResultFailed;
}
