/**
 * Phase Runner Types
 *
 * Type definitions for the phase runner module. Defines data shapes for
 * checkpoint-based resumability, plan verification, gap diagnosis/closure,
 * and the overall phase lifecycle result.
 *
 * Requirements: PHA-04, PHA-05, PHA-06, PHA-11, PHA-12
 */

import type { ForgeConfig } from "../config/schema.js";
import type { StateManager } from "../state/state-manager.js";
import type { StepRunnerContext } from "../step-runner/types.js";
import type { CostController } from "../step-runner/cost-controller.js";
import type * as nodeFs from "node:fs";

// ---------------------------------------------------------------------------
// 1. PhaseSubstep enum
// ---------------------------------------------------------------------------

/**
 * The ordered substeps within a phase lifecycle.
 * Each substep produces a checkpoint file on completion.
 */
export type PhaseSubstep =
  | "context"
  | "plan"
  | "verify-plan"
  | "execute"
  | "verify-build"
  | "gap-closure"
  | "docs";

// ---------------------------------------------------------------------------
// 2. CheckpointState interface
// ---------------------------------------------------------------------------

/**
 * Boolean flags indicating which substeps have completed.
 * Determined by checking for the existence of checkpoint files in the
 * phase directory.
 *
 * Requirements: PHA-11, PHA-12
 */
export interface CheckpointState {
  /** CONTEXT.md exists */
  contextDone: boolean;
  /** PLAN.md exists (and has been verified) */
  planDone: boolean;
  /** .execution-complete marker exists */
  executionDone: boolean;
  /** VERIFICATION.md exists */
  verificationDone: boolean;
  /** GAPS.md exists (or no gaps needed) */
  gapsDone: boolean;
  /** PHASE_REPORT.md exists */
  reportDone: boolean;
}

// ---------------------------------------------------------------------------
// 3. PlanVerificationResult interface
// ---------------------------------------------------------------------------

/**
 * Result of verifying a plan against phase requirements.
 * Pure function output -- no side effects.
 *
 * Requirements: PHA-04, PHA-05
 */
export interface PlanVerificationResult {
  /** Whether the plan passes all verification checks */
  passed: boolean;
  /** Requirement IDs found in the plan content */
  coveredRequirements: string[];
  /** Required IDs that were NOT found in the plan */
  missingRequirements: string[];
  /** Whether the plan includes test-related tasks */
  hasTestTasks: boolean;
  /** Components/modules that lack corresponding test tasks */
  missingTestTasks: string[];
  /** Whether task numbering is sequential */
  executionOrderValid: boolean;
  /** Whether the plan has success/verification criteria */
  hasSuccessCriteria: boolean;
  /** Requirement IDs in the plan that are NOT in the required set (potential scope creep) */
  scopeCreep: string[];
}

// ---------------------------------------------------------------------------
// 4. GapDiagnosis interface
// ---------------------------------------------------------------------------

/**
 * Structured output from root cause diagnosis of verification failures.
 * Produced by an agent query with outputSchema.
 *
 * Requirement: GAP-01
 */
export interface GapDiagnosis {
  /** Category of the root cause */
  category:
    | "wrong_approach"
    | "missing_dependency"
    | "integration_mismatch"
    | "requirement_ambiguity"
    | "environment_issue";
  /** Human-readable description of the root cause */
  description: string;
  /** Files affected by the issue */
  affectedFiles: string[];
  /** Suggested fix approach */
  suggestedFix: string;
  /** Command to re-test after fix */
  retestCommand: string;
}

// ---------------------------------------------------------------------------
// 5. GapFixPlan interface
// ---------------------------------------------------------------------------

/**
 * A targeted fix plan created from a root cause diagnosis.
 * Only the fix plan is executed, not the entire phase.
 *
 * Requirement: GAP-02
 */
export interface GapFixPlan {
  /** The diagnosis that led to this fix plan */
  diagnosis: GapDiagnosis;
  /** Prompt for the agent to execute the fix */
  prompt: string;
  /** Specific files that need changes */
  filesToChange: string[];
}

// ---------------------------------------------------------------------------
// 6. PhaseResult type (discriminated union)
// ---------------------------------------------------------------------------

/**
 * The outcome of running a complete phase lifecycle.
 */
export type PhaseResult =
  | { status: "completed"; report: string }
  | { status: "failed"; reason: string; gapsRemaining?: string[] }
  | {
      status: "partial";
      completedSubsteps: PhaseSubstep[];
      lastError: string;
    };

// ---------------------------------------------------------------------------
// 7. PhaseRunnerContext interface
// ---------------------------------------------------------------------------

/**
 * Dependency injection container for the phase runner.
 * All external dependencies are passed in, enabling testing with mocks.
 *
 * Requirement: PHA-01
 */
export interface PhaseRunnerContext {
  /** Project configuration */
  config: ForgeConfig;
  /** State manager for persisting orchestrator state */
  stateManager: StateManager;
  /** Step runner context for executing agent queries */
  stepRunnerContext: StepRunnerContext;
  /** Cost controller for budget tracking */
  costController: CostController;
  /** Optional filesystem implementation for testing */
  fs?: {
    existsSync: typeof nodeFs.existsSync;
    readFileSync: typeof nodeFs.readFileSync;
    writeFileSync: typeof nodeFs.writeFileSync;
    mkdirSync: typeof nodeFs.mkdirSync;
  };
}

// ---------------------------------------------------------------------------
// 8. Checkpoint file name constants
// ---------------------------------------------------------------------------

/** Checkpoint file for context gathering completion */
export const CONTEXT_FILE = "CONTEXT.md";

/** Checkpoint file for plan creation completion */
export const PLAN_FILE = "PLAN.md";

/** Checkpoint file for verification completion */
export const VERIFICATION_FILE = "VERIFICATION.md";

/** Checkpoint file for gap closure completion */
export const GAPS_FILE = "GAPS.md";

/** Checkpoint file for phase report/documentation completion */
export const REPORT_FILE = "PHASE_REPORT.md";

/** Marker file for execution completion (not a content file) */
export const EXECUTION_MARKER = ".execution-complete";
