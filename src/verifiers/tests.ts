/**
 * Tests Verifier (VER-02)
 *
 * Runs the configured test command. Falls back to exit-code-only if
 * JSON output isn't available.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
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
 * Check if the project has tests configured.
 */
function hasTestSetup(cwd: string): boolean {
  try {
    const pkgPath = path.resolve(cwd, "package.json");
    if (!fs.existsSync(pkgPath)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return !!(pkg.scripts?.test || pkg.scripts?.["test:unit"]);
  } catch {
    return false;
  }
}

/**
 * Verify that project tests pass.
 *
 * Skips if no package.json or test script exists (early phases may not
 * have tests yet). Uses configured command or falls back to npm test.
 *
 * Requirement: VER-02
 */
export const testsVerifier: Verifier = async (config): Promise<VerifierResult> => {
  if (!hasTestSetup(config.cwd)) {
    return skippedResult("tests", "No test script found in package.json");
  }

  const testCommand = config.forgeConfig.testing.unitCommand ?? "npm test";

  // Try with JSON output first
  const tmpFile = path.join(
    os.tmpdir(),
    `forge-test-results-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  // Only append --outputFile if the command looks like vitest/jest
  const supportsJsonOutput = /vitest|jest/.test(testCommand);
  const fullCommand = supportsJsonOutput
    ? `${testCommand} --outputFile=${tmpFile}`
    : testCommand;

  try {
    const result = await execWithTimeout(fullCommand, config.cwd, 120_000);

    // Try to parse JSON from the temp file (always attempt — it may have been
    // created by the underlying test runner even without --outputFile)
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
        `Test command exited with code ${result.exitCode}`,
      ],
      errors: passed
        ? []
        : [`Test command failed with exit code ${result.exitCode}`, ...truncateOutput(result.stderr || result.stdout)],
    };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Best effort cleanup
    }
  }
};

function truncateOutput(output: string): string[] {
  if (!output.trim()) return [];
  return output.trim().split("\n").slice(0, 20);
}
