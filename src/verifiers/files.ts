/**
 * Files Verifier (VER-01)
 *
 * Checks that expected files exist in the project directory.
 * Skips if no expected files are specified.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";

/**
 * Verify that all expected files exist in the project.
 *
 * Behavior:
 * - If config.expectedFiles is undefined or empty, skip
 * - For each file, resolve relative to config.cwd and check existence
 * - Pass only when ALL expected files exist
 *
 * Requirement: VER-01
 */
export const filesVerifier: Verifier = async (config): Promise<VerifierResult> => {
  if (!config.expectedFiles || config.expectedFiles.length === 0) {
    return skippedResult("files", "No expected files specified");
  }

  const details: string[] = [];
  const errors: string[] = [];

  for (const filePath of config.expectedFiles) {
    const resolved = path.resolve(config.cwd, filePath);
    if (fs.existsSync(resolved)) {
      details.push(`EXISTS: ${filePath}`);
    } else {
      details.push(`MISSING: ${filePath}`);
      errors.push(`Missing file: ${filePath}`);
    }
  }

  return {
    passed: errors.length === 0,
    verifier: "files",
    details,
    errors,
  };
};
