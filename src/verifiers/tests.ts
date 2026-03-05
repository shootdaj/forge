/**
 * Tests Verifier (VER-02)
 *
 * Runs the configured test command, parses JSON output (vitest/jest compatible),
 * and reports pass/fail based on numPassedTests and numFailedTests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Expected shape of vitest/jest JSON reporter output.
 */
interface TestJsonReport {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  numTotalTests: number;
  success: boolean;
}

/**
 * Verify that project tests pass.
 *
 * Strategy:
 * - Append --outputFile={tmpFile} to the test command to capture JSON output
 * - Parse JSON from the temp file (avoids stdout/stderr mixing)
 * - If JSON parsing fails, fall back to exit-code-only interpretation
 * - Pass when numPassedTests > 0 AND numFailedTests === 0
 *
 * Requirement: VER-02
 */
export const testsVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const testCommand = config.forgeConfig.testing.unitCommand ?? "npm test -- --json";

  // Create a temp file for JSON output to avoid stdout/stderr mixing
  const tmpFile = path.join(
    os.tmpdir(),
    `forge-test-results-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  const fullCommand = `${testCommand} --outputFile=${tmpFile}`;

  try {
    const result = await execWithTimeout(fullCommand, config.cwd, 60_000);

    // Try to parse JSON from the temp file
    let report: TestJsonReport | null = null;
    try {
      if (fs.existsSync(tmpFile)) {
        const jsonContent = fs.readFileSync(tmpFile, "utf-8");
        report = JSON.parse(jsonContent) as TestJsonReport;
      }
    } catch {
      // JSON parsing failed — fall back to exit code
    }

    if (report) {
      const { numPassedTests, numFailedTests, numPendingTests, numTotalTests } = report;
      const pending = numPendingTests ?? 0;
      const passed = numPassedTests > 0 && numFailedTests === 0;

      return {
        passed,
        verifier: "tests",
        details: [
          `${numPassedTests} passed, ${numFailedTests} failed, ${pending} pending out of ${numTotalTests} total`,
        ],
        errors: passed
          ? []
          : [
              ...(numFailedTests > 0 ? [`numFailedTests: ${numFailedTests}`] : []),
              ...(numPassedTests === 0 ? ["No tests passed (numPassedTests === 0)"] : []),
            ],
      };
    }

    // Fallback: exit-code-only interpretation
    const passed = result.exitCode === 0;
    return {
      passed,
      verifier: "tests",
      details: [
        `Test command exited with code ${result.exitCode} (JSON output not available)`,
      ],
      errors: passed
        ? []
        : [`Test command failed with exit code ${result.exitCode}`, ...truncateOutput(result.stderr || result.stdout)],
    };
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Best effort cleanup
    }
  }
};

/**
 * Truncate output to the first 20 lines for error reporting.
 */
function truncateOutput(output: string): string[] {
  if (!output.trim()) return [];
  const lines = output.trim().split("\n").slice(0, 20);
  return lines;
}
