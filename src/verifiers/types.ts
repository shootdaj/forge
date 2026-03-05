/**
 * Verifier Type System
 *
 * Core interfaces and types for the programmatic verification pipeline.
 * All verifiers implement the Verifier function type and return VerifierResult.
 *
 * Requirements: VER-01 through VER-08
 */

import type { ForgeConfig } from "../config/schema.js";

/**
 * Result of a single verifier execution.
 *
 * - `passed` is true when the check succeeds OR was skipped
 * - `verifier` identifies which verifier produced this result
 * - `details` contains human-readable descriptions of what was checked
 * - `errors` contains specific failure messages with file paths/line numbers
 */
export interface VerifierResult {
  passed: boolean;
  verifier: string;
  details: string[];
  errors: string[];
}

/**
 * Configuration passed to each verifier function.
 *
 * - `cwd` is the project root directory
 * - `forgeConfig` is the fully parsed Forge config
 * - `expectedFiles` is an optional list of file paths to verify (for files verifier)
 * - `gitRef` is an optional git ref for diffing (defaults to "main")
 */
export interface VerifierConfig {
  cwd: string;
  forgeConfig: ForgeConfig;
  expectedFiles?: string[];
  gitRef?: string;
}

/**
 * A verifier is an async function that inspects the project and returns a result.
 * Each verifier is standalone and independently testable.
 */
export type Verifier = (config: VerifierConfig) => Promise<VerifierResult>;

/**
 * Aggregated report from running multiple verifiers.
 *
 * - `passed` is true only when ALL individual verifiers passed
 * - `results` contains the result from each verifier that ran
 * - `summary` provides aggregate counts
 * - `durationMs` is the total wall-clock time for all verifiers
 */
export interface VerificationReport {
  passed: boolean;
  results: VerifierResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
}

/**
 * Helper to create a skipped verifier result.
 *
 * Skipped results are treated as passing (they don't block the pipeline).
 * Used when prerequisites are missing (e.g., no tsconfig.json for typecheck).
 */
export function skippedResult(
  verifierName: string,
  reason: string,
): VerifierResult {
  return {
    passed: true,
    verifier: verifierName,
    details: [`Skipped: ${reason}`],
    errors: [],
  };
}
