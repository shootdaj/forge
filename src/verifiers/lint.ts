/**
 * Lint Verifier (VER-04)
 *
 * Runs the configured lint command and uses exit code as primary signal.
 */

import type { Verifier, VerifierResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Verify that the project passes linting.
 *
 * Behavior:
 * - Runs `eslint src/ --no-color` as default lint command
 * - Uses exit code as primary pass/fail signal
 * - Captures first 50 lines of output for error reporting
 *
 * Requirement: VER-04
 */
export const lintVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const lintCommand = "eslint src/ --no-color";

  const result = await execWithTimeout(lintCommand, config.cwd, 30_000);

  const passed = result.exitCode === 0;
  const combinedOutput = (result.stdout + "\n" + result.stderr).trim();

  return {
    passed,
    verifier: "lint",
    details: [`Lint check: ${passed ? "passed" : "failed"}`],
    errors: passed
      ? []
      : combinedOutput
          .split("\n")
          .slice(0, 50)
          .filter((line) => line.trim().length > 0),
  };
};
