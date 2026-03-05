/**
 * Phase Runner Module - Public API
 *
 * Exposes the main runPhase() function and all types needed
 * by consumers (pipeline controller, CLI).
 *
 * Requirement: PHA-01
 */

export { runPhase } from "./phase-runner.js";
export type { RunPhaseOptions } from "./phase-runner.js";

export type {
  PhaseResult,
  PhaseRunnerContext,
  PhaseSubstep,
  CheckpointState,
  PlanVerificationResult,
  GapDiagnosis,
  GapFixPlan,
} from "./types.js";

export {
  CONTEXT_FILE,
  PLAN_FILE,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
  EXECUTION_MARKER,
} from "./types.js";

export {
  detectCheckpoints,
  writeCheckpoint,
  resolvePhaseDir,
  getCompletedSubsteps,
} from "./checkpoint.js";

export {
  verifyPlanCoverage,
  parsePlanRequirements,
  injectTestTasks,
} from "./plan-verification.js";
