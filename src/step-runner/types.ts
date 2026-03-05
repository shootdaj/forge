/**
 * Step Runner Types
 *
 * Type definitions for the step execution primitive and cost controller.
 * These types define how Forge wraps individual query() calls with budget
 * enforcement, verification, and failure cascade.
 *
 * Requirements: STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06,
 *               COST-01, COST-02, COST-03, COST-04
 */

import type { ForgeConfig } from "../config/schema.js";
import type {
  ForgeQueryOptions,
  QueryResult,
  CostData,
  SDKErrorCategory,
} from "../sdk/types.js";
import type { StateManager } from "../state/state-manager.js";

/**
 * Verification callback signature.
 * Called after a step executes to programmatically verify the outcome.
 *
 * Requirement: STEP-01
 */
export type VerifyFn = () => Promise<boolean>;

/**
 * Options for a single step execution.
 *
 * Requirement: STEP-01
 */
export interface StepOptions {
  /** The prompt to send to the agent */
  prompt: string;
  /** Verification callback -- runs after execution to confirm success */
  verify: VerifyFn;
  /** Phase number this step belongs to (for cost tracking) */
  phase?: number;
  /** Override per-step budget (defaults to config.maxBudgetPerStep) */
  maxBudgetUsd?: number;
  /** Override max turns (defaults to config.maxTurnsPerStep) */
  maxTurns?: number;
  /** JSON schema for structured output extraction */
  outputSchema?: Record<string, unknown>;
  /** Working directory override */
  cwd?: string;
  /** Model override */
  model?: string;
}

/**
 * Step result when execution completed and verification passed.
 */
export interface StepResultVerified {
  status: "verified";
  /** Cost of this step in USD */
  costUsd: number;
  /** Full cost data from the SDK */
  costData: CostData;
  /** Text result from the agent */
  result: string;
  /** Parsed structured output if outputSchema was used */
  structuredOutput: unknown;
  /** Session ID for debugging */
  sessionId: string;
}

/**
 * Step result when execution completed but verification failed.
 */
export interface StepResultFailed {
  status: "failed";
  /** Cost of this step in USD */
  costUsd: number;
  /** Full cost data from the SDK */
  costData: CostData;
  /** Whether partial work may exist */
  mayHavePartialWork: boolean;
  /** Error message describing what failed */
  error: string;
  /** Text result from the agent (if available) */
  result?: string;
  /** Session ID for debugging */
  sessionId?: string;
}

/**
 * Step result when cascade decided to skip this step.
 */
export interface StepResultSkipped {
  status: "skipped";
  /** Total cost spent across all attempts */
  costUsd: number;
  /** Why the step was skipped */
  reason: string;
  /** Attempts history */
  attempts: AttemptRecord[];
}

/**
 * Step result when an SDK infrastructure error occurred (not retried).
 *
 * Requirement: STEP-06
 */
export interface StepResultError {
  status: "error";
  /** Cost charged even on error */
  costUsd: number;
  /** Full cost data from the SDK */
  costData: CostData;
  /** The SDK error category */
  sdkErrorCategory: SDKErrorCategory;
  /** Error message */
  error: string;
  /** Whether this is an SDK infrastructure error (not a step logic failure) */
  sdkError: true;
  /** Session ID for debugging */
  sessionId?: string;
}

/**
 * Step result when budget was exceeded before starting.
 *
 * Requirement: STEP-02, COST-02
 */
export interface StepResultBudgetExceeded {
  status: "budget_exceeded";
  /** No cost charged -- step never started */
  costUsd: 0;
  /** Current total budget used */
  totalBudgetUsed: number;
  /** Project budget limit */
  maxBudgetTotal: number;
  /** Error message */
  error: string;
}

/**
 * Discriminated union of all step outcomes.
 */
export type StepResult =
  | StepResultVerified
  | StepResultFailed
  | StepResultSkipped
  | StepResultError
  | StepResultBudgetExceeded;

/**
 * Record of a single attempt in the cascade.
 *
 * Requirement: STEP-04
 */
export interface AttemptRecord {
  /** Attempt number (1-based) */
  attempt: number;
  /** The prompt used for this attempt */
  prompt: string;
  /** The approach description */
  approach: string;
  /** Error message if it failed */
  error: string;
  /** Cost of this attempt */
  costUsd: number;
}

/**
 * Callback that decides what to do when a step fails in the cascade.
 *
 * Requirement: STEP-04
 */
export type OnFailureCallback = (
  error: string,
  attempt: number,
  history: AttemptRecord[],
) => Promise<OnFailureDecision>;

/**
 * Decision from the onFailure callback.
 */
export type OnFailureDecision =
  | { action: "retry"; newPrompt: string; approach: string }
  | { action: "skip"; reason: string }
  | { action: "stop"; reason: string };

/**
 * Options for the failure cascade wrapper.
 *
 * Requirement: STEP-04
 */
export interface CascadeOptions extends StepOptions {
  /** Callback to decide retry strategy on failure */
  onFailure: OnFailureCallback;
  /** Whether this step can be skipped (default: true) */
  skippable?: boolean;
  /** Maximum retries (defaults to config.maxRetries) */
  maxRetries?: number;
}

/**
 * Result from runStepWithCascade.
 * Extends StepResult with cascade metadata.
 */
export interface CascadeResult {
  /** The final step result */
  result: StepResult;
  /** All attempts made */
  attempts: AttemptRecord[];
  /** Total cost across all attempts */
  totalCostUsd: number;
}

/**
 * Cost log entry for per-step tracking.
 *
 * Requirement: COST-04
 */
export interface CostLogEntry {
  /** Step name */
  stepName: string;
  /** Phase number (if applicable) */
  phase?: number;
  /** Cost in USD */
  costUsd: number;
  /** Full cost data */
  costData: CostData;
  /** Timestamp */
  timestamp: string;
  /** Step status */
  status: StepResult["status"];
  /** Session ID for debugging */
  sessionId?: string;
}

/**
 * Dependencies injected into step runner functions.
 * Enables testing with mocked SDK and state.
 */
export interface StepRunnerContext {
  /** Project configuration */
  config: ForgeConfig;
  /** State manager instance */
  stateManager: StateManager;
  /** The executeQuery function (injectable for testing) */
  executeQueryFn: <T = unknown>(
    opts: ForgeQueryOptions,
    queryFn?: (args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncIterable<{
      type: string;
      subtype?: string;
      [key: string]: unknown;
    }>,
  ) => Promise<QueryResult<T>>;
}

/**
 * Custom error thrown when project budget is exceeded.
 *
 * Requirement: STEP-02, COST-02
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly totalBudgetUsed: number,
    public readonly maxBudgetTotal: number,
  ) {
    super(
      `Project budget exceeded: $${totalBudgetUsed.toFixed(2)} used of $${maxBudgetTotal.toFixed(2)} limit`,
    );
    this.name = "BudgetExceededError";
  }
}
