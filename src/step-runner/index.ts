/**
 * Step Runner module - Forge's core execution primitive
 *
 * Wraps individual SDK query() calls with budget enforcement,
 * cost tracking, verification, and failure cascade.
 *
 * Requirements: STEP-01..06, COST-01..04
 */

export { runStep } from "./step-runner.js";
export { runStepWithCascade } from "./cascade.js";
export { CostController } from "./cost-controller.js";
export { BudgetExceededError } from "./types.js";

export type {
  StepOptions,
  StepResult,
  StepResultVerified,
  StepResultFailed,
  StepResultSkipped,
  StepResultError,
  StepResultBudgetExceeded,
  StepRunnerContext,
  CascadeOptions,
  CascadeResult,
  AttemptRecord,
  OnFailureCallback,
  OnFailureDecision,
  CostLogEntry,
  VerifyFn,
} from "./types.js";
