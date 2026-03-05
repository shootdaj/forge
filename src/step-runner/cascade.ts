/**
 * Failure Cascade
 *
 * Wraps runStep() with a three-tier failure cascade:
 * 1. Retry up to N times with different approaches (includes prior error context)
 * 2. Skip and flag (record what was tried)
 * 3. Stop (if step is non-skippable)
 *
 * SDK errors (network, auth) bypass the cascade entirely.
 *
 * Requirements: STEP-04, STEP-06
 */

import type {
  CascadeOptions,
  CascadeResult,
  AttemptRecord,
  StepRunnerContext,
  StepResultSkipped,
} from "./types.js";
import type { CostController } from "./cost-controller.js";
import { runStep } from "./step-runner.js";

/**
 * Execute a step with failure cascade: retry -> skip -> stop.
 *
 * This wraps runStep() and adds the three-tier retry logic described in
 * SPEC.md section 7 (Failure Handling).
 *
 * Flow:
 * 1. Run the step. If it succeeds ("verified"), return immediately.
 * 2. If it fails with an SDK error (network/auth), return immediately (STEP-06).
 * 3. If it fails with "budget_exceeded" at project level, return immediately.
 * 4. On step failure: call onFailure callback to get retry/skip/stop decision.
 * 5. On "retry": re-run with new prompt (up to maxRetries times).
 *    Each retry includes all prior error context.
 * 6. On "skip": record attempt history, return skipped result.
 * 7. On "stop": record attempt history, return failed result with stop flag.
 *
 * Requirements: STEP-04, STEP-06
 *
 * @param name - Step identifier
 * @param opts - Cascade options (extends StepOptions with onFailure callback)
 * @param ctx - Injected dependencies
 * @param costController - Cost tracking
 */
export async function runStepWithCascade(
  name: string,
  opts: CascadeOptions,
  ctx: StepRunnerContext,
  costController: CostController,
): Promise<CascadeResult> {
  const maxRetries = opts.maxRetries ?? ctx.config.maxRetries;
  const skippable = opts.skippable !== false; // default: true
  const attempts: AttemptRecord[] = [];
  let totalCost = 0;

  // Build the step options for each attempt
  let currentPrompt = opts.prompt;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const stepResult = await runStep(
      name,
      {
        ...opts,
        prompt: currentPrompt,
      },
      ctx,
      costController,
    );

    totalCost += stepResult.costUsd;

    // ─── Success: return immediately ───
    if (stepResult.status === "verified") {
      return {
        result: stepResult,
        attempts,
        totalCostUsd: totalCost,
      };
    }

    // ─── SDK error: bypass cascade entirely (STEP-06) ───
    if (stepResult.status === "error" && stepResult.sdkError) {
      return {
        result: stepResult,
        attempts,
        totalCostUsd: totalCost,
      };
    }

    // ─── Project budget exceeded: cannot retry ───
    if (stepResult.status === "budget_exceeded") {
      return {
        result: stepResult,
        attempts,
        totalCostUsd: totalCost,
      };
    }

    // ─── Step failed: record attempt and decide next action ───
    const errorMessage =
      stepResult.status === "failed"
        ? stepResult.error
        : `Step returned unexpected status: ${stepResult.status}`;

    const attemptRecord: AttemptRecord = {
      attempt,
      prompt: currentPrompt,
      approach: attempt === 1 ? "initial" : `retry-${attempt - 1}`,
      error: errorMessage,
      costUsd: stepResult.costUsd,
    };
    attempts.push(attemptRecord);

    // If we've used all retries, break out of the loop
    if (attempt > maxRetries) {
      break;
    }

    // Ask the onFailure callback what to do
    const decision = await opts.onFailure(errorMessage, attempt, attempts);

    if (decision.action === "retry") {
      // Update prompt for next attempt with error context
      currentPrompt = decision.newPrompt;
      // Update the last attempt's approach description
      attemptRecord.approach = decision.approach;
      continue;
    }

    if (decision.action === "skip") {
      if (!skippable) {
        // Step is non-skippable -- treat as stop
        return {
          result: {
            status: "failed",
            costUsd: totalCost,
            costData: stepResult.status === "failed" ? stepResult.costData : {
              totalCostUsd: 0,
              numTurns: 0,
              usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
              modelUsage: {},
              durationMs: 0,
              durationApiMs: 0,
            },
            mayHavePartialWork: true,
            error: `Non-skippable step failed after ${attempt} attempt(s): ${decision.reason}`,
          },
          attempts,
          totalCostUsd: totalCost,
        };
      }

      // Record the skip in state
      await ctx.stateManager.update((state) => ({
        ...state,
        skippedItems: [
          ...state.skippedItems,
          {
            requirement: name,
            phase: opts.phase ?? 0,
            attempts: attempts.map((a) => ({
              approach: a.approach,
              error: a.error,
            })),
          },
        ],
      }));

      const skippedResult: StepResultSkipped = {
        status: "skipped",
        costUsd: totalCost,
        reason: decision.reason,
        attempts,
      };

      return {
        result: skippedResult,
        attempts,
        totalCostUsd: totalCost,
      };
    }

    if (decision.action === "stop") {
      return {
        result: {
          status: "failed",
          costUsd: totalCost,
          costData: stepResult.status === "failed" ? stepResult.costData : {
            totalCostUsd: 0,
            numTurns: 0,
            usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
            modelUsage: {},
            durationMs: 0,
            durationApiMs: 0,
          },
          mayHavePartialWork: true,
          error: `Step stopped after ${attempt} attempt(s): ${decision.reason}`,
        },
        attempts,
        totalCostUsd: totalCost,
      };
    }
  }

  // All retries exhausted -- apply default cascade behavior
  // After maxRetries exhausted, skip if skippable, stop if not
  if (skippable) {
    // Record the skip in state
    await ctx.stateManager.update((state) => ({
      ...state,
      skippedItems: [
        ...state.skippedItems,
        {
          requirement: name,
          phase: opts.phase ?? 0,
          attempts: attempts.map((a) => ({
            approach: a.approach,
            error: a.error,
          })),
        },
      ],
    }));

    const skippedResult: StepResultSkipped = {
      status: "skipped",
      costUsd: totalCost,
      reason: `All ${maxRetries} retries exhausted`,
      attempts,
    };

    return {
      result: skippedResult,
      attempts,
      totalCostUsd: totalCost,
    };
  }

  // Non-skippable: return failed
  return {
    result: {
      status: "failed",
      costUsd: totalCost,
      costData: {
        totalCostUsd: 0,
        numTurns: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        modelUsage: {},
        durationMs: 0,
        durationApiMs: 0,
      },
      mayHavePartialWork: true,
      error: `Non-skippable step failed after ${attempts.length} attempt(s)`,
    },
    attempts,
    totalCostUsd: totalCost,
  };
}
