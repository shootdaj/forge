/**
 * Verifier Registry and Orchestrator (VER-09)
 *
 * Single entry point for the verification pipeline. Maps all 8 verifiers,
 * reads config toggles to determine which are enabled, and runs them with
 * the correct execution strategy:
 * - Non-docker verifiers run in parallel via Promise.allSettled
 * - Docker verifier runs sequentially AFTER all others pass
 * - Results aggregated into VerificationReport with summary counts
 *
 * Requirement: VER-09
 */

import type { ForgeConfig } from "../config/schema.js";
import type { Verifier, VerifierConfig, VerifierResult, VerificationReport } from "./types.js";
import { skippedResult } from "./types.js";
import { filesVerifier } from "./files.js";
import { testsVerifier } from "./tests.js";
import { typecheckVerifier } from "./typecheck.js";
import { lintVerifier } from "./lint.js";
import { coverageVerifier } from "./coverage.js";
import { observabilityVerifier } from "./observability.js";
import { dockerVerifier } from "./docker.js";
import { deploymentVerifier } from "./deployment.js";

// Re-export types and helpers for consumers
export type {
  Verifier,
  VerifierConfig,
  VerifierResult,
  VerificationReport,
} from "./types.js";
export { skippedResult } from "./types.js";

// Re-export individual verifiers for direct use
export { filesVerifier } from "./files.js";
export { testsVerifier } from "./tests.js";
export { typecheckVerifier } from "./typecheck.js";
export { lintVerifier } from "./lint.js";
export { coverageVerifier } from "./coverage.js";
export { observabilityVerifier } from "./observability.js";
export { dockerVerifier } from "./docker.js";
export { deploymentVerifier } from "./deployment.js";

/**
 * Registry mapping verifier names to their implementation functions.
 * All 8 verifiers from Plan 01 are wired here.
 */
export const verifierRegistry: Record<string, Verifier> = {
  files: filesVerifier,
  tests: testsVerifier,
  typecheck: typecheckVerifier,
  lint: lintVerifier,
  coverage: coverageVerifier,
  observability: observabilityVerifier,
  docker: dockerVerifier,
  deployment: deploymentVerifier,
};

/**
 * Mapping from ForgeConfig.verification property names (camelCase)
 * to registry keys.
 *
 * Config property -> Registry name:
 * - files -> "files"
 * - tests -> "tests"
 * - typecheck -> "typecheck"
 * - lint -> "lint"
 * - testCoverageCheck -> "coverage"
 * - observabilityCheck -> "observability"
 * - dockerSmoke -> "docker"
 * - deployment -> "deployment"
 */
const configToRegistryMap: Record<string, string> = {
  files: "files",
  tests: "tests",
  typecheck: "typecheck",
  lint: "lint",
  testCoverageCheck: "coverage",
  observabilityCheck: "observability",
  dockerSmoke: "docker",
  deployment: "deployment",
};

/**
 * Determine which verifiers are enabled based on ForgeConfig.verification toggles.
 *
 * Reads each toggle from the verification config and maps it to the
 * corresponding registry name. Returns only verifiers where the toggle is true.
 *
 * @param forgeConfig - The fully parsed Forge configuration
 * @returns Array of registry names for enabled verifiers
 */
export function getEnabledVerifiers(forgeConfig: ForgeConfig): string[] {
  const verification = forgeConfig.verification;
  const enabled: string[] = [];

  for (const [configKey, registryName] of Object.entries(configToRegistryMap)) {
    const toggleValue = verification[configKey as keyof typeof verification];
    if (toggleValue === true) {
      enabled.push(registryName);
    }
  }

  return enabled;
}

/**
 * Run all enabled verifiers with the correct execution strategy.
 *
 * Execution strategy (from CONTEXT.md, locked):
 * 1. Phase 1: Run all enabled non-docker verifiers in parallel via Promise.allSettled
 * 2. Phase 2: If docker is enabled AND all non-docker verifiers passed, run docker sequentially
 *    - If docker is enabled but non-docker verifiers failed, skip docker with a skip result
 * 3. Aggregate all results into a VerificationReport
 *
 * Error handling:
 * - Individual verifier failures do NOT prevent other verifiers from running (Promise.allSettled)
 * - If a verifier throws (rejects), a synthetic failed result is created
 * - Skipped verifiers count as not-failed (passed: true) in the report
 *
 * @param config - Configuration for all verifiers (cwd, forgeConfig, optional overrides)
 * @returns Aggregated VerificationReport with results and summary counts
 */
export async function runVerifiers(config: VerifierConfig): Promise<VerificationReport> {
  const startTime = Date.now();

  const enabledNames = getEnabledVerifiers(config.forgeConfig);

  // Separate non-docker and docker
  const nonDockerNames = enabledNames.filter((name) => name !== "docker");
  const dockerEnabled = enabledNames.includes("docker");

  // Phase 1: Run all non-docker verifiers in parallel
  const settledResults = await Promise.allSettled(
    nonDockerNames.map((name) => {
      const verifier = verifierRegistry[name];
      return verifier(config).then((result) => ({ name, result }));
    }),
  );

  // Collect results, creating synthetic failures for rejected promises
  const results: VerifierResult[] = [];

  for (let i = 0; i < settledResults.length; i++) {
    const settled = settledResults[i];
    const name = nonDockerNames[i];

    if (settled.status === "fulfilled") {
      results.push(settled.value.result);
    } else {
      // Verifier threw an error - create synthetic failed result
      const errorMessage =
        settled.reason instanceof Error
          ? settled.reason.message
          : String(settled.reason);
      results.push({
        passed: false,
        verifier: name,
        details: [],
        errors: [`Verifier threw: ${errorMessage}`],
      });
    }
  }

  // Determine if all non-docker verifiers passed
  const allNonDockerPassed = results.every((r) => r.passed);

  // Phase 2: Conditional docker execution
  if (dockerEnabled) {
    if (allNonDockerPassed) {
      // Run docker verifier sequentially
      try {
        const dockerResult = await verifierRegistry.docker(config);
        results.push(dockerResult);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          passed: false,
          verifier: "docker",
          details: [],
          errors: [`Verifier threw: ${errorMessage}`],
        });
      }
    } else {
      // Skip docker because non-docker verifiers failed
      results.push(
        skippedResult("docker", "Skipped: non-docker verifiers failed"),
      );
    }
  }

  // Aggregate report
  const durationMs = Date.now() - startTime;

  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const result of results) {
    const isSkipped =
      result.details.length > 0 && result.details[0].startsWith("Skipped:");

    if (isSkipped) {
      summary.skipped++;
    } else if (result.passed) {
      summary.passed++;
    } else {
      summary.failed++;
    }
  }

  return {
    passed: results.every((r) => r.passed),
    results,
    summary,
    durationMs,
  };
}
