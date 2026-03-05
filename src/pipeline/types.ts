/**
 * Pipeline Controller Types
 *
 * Type definitions for the pipeline controller module. Defines data shapes for
 * the wave model FSM, dependency graph, mock management, human checkpoint,
 * and spec compliance.
 *
 * Requirements: PIPE-11, PIPE-02, PIPE-03, MOCK-01, MOCK-02, MOCK-03, MOCK-04
 */

import type { ForgeConfig } from "../config/schema.js";
import type { StateManager } from "../state/state-manager.js";
import type { StepRunnerContext } from "../step-runner/types.js";
import type { CostController } from "../step-runner/cost-controller.js";
import type {
  PhaseResult,
  PhaseRunnerContext,
} from "../phase-runner/types.js";
import type { RunPhaseOptions } from "../phase-runner/phase-runner.js";
import type * as nodeFs from "node:fs";

// ---------------------------------------------------------------------------
// 1. PipelinePhase -- a phase parsed from the roadmap
// ---------------------------------------------------------------------------

/**
 * Represents a phase parsed from the project roadmap.
 * Used by the dependency graph to determine execution order.
 *
 * Requirement: PIPE-11
 */
export interface PipelinePhase {
  /** Phase number (1-based) */
  number: number;
  /** Phase name/title */
  name: string;
  /** Phase numbers this depends on */
  dependsOn: number[];
  /** Requirement IDs covered by this phase */
  requirementIds: string[];
  /** Full description of the phase */
  description: string;
}

// ---------------------------------------------------------------------------
// 2. PipelineContext -- dependency injection container
// ---------------------------------------------------------------------------

/**
 * Dependency injection container for the pipeline controller.
 * Mirrors PhaseRunnerContext pattern: all external dependencies are injected.
 *
 * Requirement: PIPE-01
 */
export interface PipelineContext {
  /** Project configuration */
  config: ForgeConfig;
  /** State manager for persisting orchestrator state */
  stateManager: StateManager;
  /** Step runner context for executing agent queries */
  stepRunnerContext: StepRunnerContext;
  /** Cost controller for budget tracking */
  costController: CostController;
  /** Injectable phase runner function (for testing) */
  runPhaseFn: (
    phaseNumber: number,
    ctx: PhaseRunnerContext,
    options?: RunPhaseOptions,
  ) => Promise<PhaseResult>;
  /** Optional filesystem implementation for testing */
  fs?: {
    existsSync: typeof nodeFs.existsSync;
    readFileSync: typeof nodeFs.readFileSync;
    writeFileSync: typeof nodeFs.writeFileSync;
    mkdirSync: typeof nodeFs.mkdirSync;
  };
}

// ---------------------------------------------------------------------------
// 3. PipelineResult -- outcome of full pipeline run (discriminated union)
// ---------------------------------------------------------------------------

/**
 * The outcome of running the full pipeline.
 * Discriminated union on `status`.
 *
 * Requirement: PIPE-03
 */
export type PipelineResult =
  | {
      status: "completed";
      wavesCompleted: number;
      phasesCompleted: number[];
      totalCostUsd: number;
      specCompliance: SpecComplianceResult;
    }
  | {
      status: "checkpoint";
      wave: number;
      checkpointReport: CheckpointReport;
      phasesCompletedSoFar: number[];
    }
  | {
      status: "failed";
      wave: number;
      reason: string;
      phasesCompletedSoFar: number[];
      phasesFailed: number[];
    }
  | {
      status: "stuck";
      wave: number;
      reason: string;
      nonConverging: boolean;
      gapHistory: number[];
    };

// ---------------------------------------------------------------------------
// 4. WaveResult -- outcome of a single wave
// ---------------------------------------------------------------------------

/**
 * The outcome of executing a single wave of phases.
 *
 * Requirement: PIPE-02
 */
export interface WaveResult {
  /** Wave number (1-based) */
  wave: number;
  /** Phase numbers that completed successfully */
  phasesCompleted: number[];
  /** Phase numbers that failed */
  phasesFailed: number[];
  /** External services detected during this wave */
  servicesDetected: ServiceDetection[];
  /** Items that were skipped (could not be built) */
  skippedItems: SkippedItem[];
}

// ---------------------------------------------------------------------------
// 5. ServiceDetection -- external service found in a phase
// ---------------------------------------------------------------------------

/**
 * An external service detected from a phase description.
 * Used by the mock manager to generate mock instructions.
 *
 * Requirement: PIPE-02, MOCK-01
 */
export interface ServiceDetection {
  /** Service name (e.g., "stripe", "sendgrid") */
  service: string;
  /** Why this service is needed */
  why: string;
  /** Phase number where it was detected */
  phase: number;
  /** URL to sign up for the service */
  signupUrl?: string;
  /** Credential environment variables needed */
  credentialsNeeded: string[];
}

// ---------------------------------------------------------------------------
// 6. MockEntry -- mirrors the state schema's mock registry entry
// ---------------------------------------------------------------------------

/**
 * A mock registry entry tracking the 4-file pattern for a mocked service.
 * Compatible with ForgeState.mockRegistry entries.
 *
 * Requirement: MOCK-01, MOCK-02, MOCK-04
 */
export interface MockEntry {
  /** Path to the TypeScript interface file */
  interface: string;
  /** Path to the mock implementation file */
  mock: string;
  /** Path to the real implementation file (stub in Wave 1) */
  real: string;
  /** Path to the factory file (returns mock or real based on env) */
  factory: string;
  /** Paths to test fixture files */
  testFixtures: string[];
  /** Environment variables used by this service */
  envVars: string[];
}

// ---------------------------------------------------------------------------
// 7. SkippedItem -- reuse-compatible type from state schema
// ---------------------------------------------------------------------------

/**
 * An item that was skipped during execution.
 * Compatible with ForgeState.skippedItems entries.
 */
export interface SkippedItem {
  /** Requirement ID that was skipped */
  requirement: string;
  /** Phase number where skipping occurred */
  phase: number;
  /** Approaches attempted before skipping */
  attempts: Array<{ approach: string; error: string }>;
  /** Path to partial code produced, if any */
  codeSoFar?: string;
}

// ---------------------------------------------------------------------------
// 8. CheckpointReport -- data for the human checkpoint
// ---------------------------------------------------------------------------

/**
 * Data gathered for the human checkpoint between Wave 1 and Wave 2.
 * Batches ALL human needs into a single interruption.
 *
 * Requirement: PIPE-04
 */
export interface CheckpointReport {
  /** External services that need real credentials */
  servicesNeeded: ServiceDetection[];
  /** Items that were skipped and need human guidance */
  skippedItems: SkippedItem[];
  /** Ideas deferred to later (nice-to-haves) */
  deferredIdeas: string[];
  /** Summary of Wave 1 execution */
  wave1Summary: {
    phasesCompleted: number;
    phasesFailed: number;
    requirementsBuilt: number;
    requirementsTotal: number;
  };
}

// ---------------------------------------------------------------------------
// 9. SpecComplianceResult -- outcome of spec compliance verification
// ---------------------------------------------------------------------------

/**
 * Result of running the spec compliance loop (Wave 3+).
 * Tracks convergence of gap fixes.
 *
 * Requirement: PIPE-08
 */
export interface SpecComplianceResult {
  /** Whether all requirements are verified */
  converged: boolean;
  /** Number of compliance rounds completed */
  roundsCompleted: number;
  /** History of gap counts per round (should decrease) */
  gapHistory: number[];
  /** Requirement IDs still not verified */
  remainingGaps: string[];
}
