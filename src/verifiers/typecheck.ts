/**
 * Typecheck Verifier (VER-03)
 *
 * Runs `tsc --noEmit --pretty false` and parses error output.
 * Skips if no tsconfig.json is found.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Verify that the TypeScript project compiles without errors.
 *
 * Behavior:
 * - Skip if no tsconfig.json exists in cwd
 * - Run tsc --noEmit --pretty false to get parseable output
 * - Parse error patterns from output: file(line,col): error TSxxxx: message
 * - Report first 20 errors to avoid flooding
 *
 * Requirement: VER-03
 */
export const typecheckVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const tsconfigPath = path.resolve(config.cwd, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return skippedResult("typecheck", "No tsconfig.json found");
  }

  const result = await execWithTimeout(
    "npx tsc --noEmit --pretty false",
    config.cwd,
    60_000,
  );

  // Parse tsc error output
  // Format: src/foo.ts(10,5): error TS2345: Argument of type...
  const errorPattern = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;
  const errors: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = errorPattern.exec(result.stdout + "\n" + result.stderr)) !== null) {
    if (errors.length < 20) {
      const [, file, line, col, code, message] = match;
      errors.push(`${file}:${line}:${col} - ${code}: ${message}`);
    }
  }

  const passed = result.exitCode === 0 && errors.length === 0;

  return {
    passed,
    verifier: "typecheck",
    details: [`TypeScript compilation: ${errors.length} error(s)`],
    errors,
  };
};
