/**
 * Maestro UAT Types and Error Classes
 *
 * Type definitions and error classes for Maestro test execution
 * and JUnit XML result parsing.
 *
 * Requirements: MAE-01, MAE-02
 */

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all Maestro-related errors.
 */
export class MaestroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaestroError";
  }
}

/**
 * Thrown when maestro test fails to execute (not a test failure, a CLI error).
 *
 * Requirement: MAE-01
 */
export class MaestroTestError extends MaestroError {
  constructor(reason: string) {
    super(`Maestro test failed: ${reason}`);
    this.name = "MaestroTestError";
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Result of a single Maestro flow execution.
 *
 * Requirement: MAE-01
 */
export interface MaestroFlowResult {
  /** Name of the flow (from JUnit testcase name) */
  name: string;
  /** Whether the flow passed */
  passed: boolean;
  /** Duration of the flow in milliseconds */
  durationMs: number;
  /** Error message if the flow failed */
  error?: string;
}

/**
 * Aggregate result of all Maestro flow executions.
 *
 * Requirement: MAE-01, MAE-02
 */
export interface MaestroResult {
  /** Whether all flows passed */
  passed: boolean;
  /** Total number of flows executed */
  totalFlows: number;
  /** Number of flows that passed */
  passedFlows: number;
  /** Number of flows that failed */
  failedFlows: number;
  /** Per-flow results */
  flowResults: MaestroFlowResult[];
}

/**
 * Options for running Maestro tests.
 *
 * Requirement: MAE-01
 */
export interface MaestroTestOptions {
  /** Directory containing Maestro flow YAML files */
  flowsDir: string;
  /** Path for the JUnit XML output report */
  outputPath?: string;
  /** ADB serial of the target device (optional) */
  serial?: string;
  /** Injectable exec function for testing */
  execFn?: (cmd: string) => string;
}
