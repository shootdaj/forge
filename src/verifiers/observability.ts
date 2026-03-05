/**
 * Observability Verifier (VER-06)
 *
 * Checks for health endpoint, structured logging, and error logging patterns.
 * Only FAILS on missing health endpoint (most critical and reliably detectable).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * Verify observability patterns in the project.
 *
 * Three-check heuristic:
 * a. Health endpoint: grep for /health route patterns
 * b. Structured logging: check for pino/winston/bunyan imports
 * c. Error logging: check for .error() patterns
 *
 * Only fails on missing health endpoint (most critical).
 * Structured logging and error logging are informational warnings.
 *
 * Requirement: VER-06
 */
export const observabilityVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const srcDir = path.resolve(config.cwd, "src");
  if (!fs.existsSync(srcDir)) {
    return skippedResult("observability", "No src/ directory found");
  }

  const details: string[] = [];
  const errors: string[] = [];

  // Check 1: Health endpoint
  const healthResult = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.js" -E "(app|router)\\.(get|use)\\s*\\(\\s*['\"\`]\\/health|healthCheck|healthcheck|\\/healthz" src/`,
    config.cwd,
    10_000,
  );

  const hasHealthEndpoint = healthResult.exitCode === 0 && healthResult.stdout.trim().length > 0;
  if (hasHealthEndpoint) {
    const files = healthResult.stdout.trim().split("\n").slice(0, 3);
    details.push(`Health endpoint: FOUND (${files.join(", ")})`);
  } else {
    details.push("Health endpoint: NOT FOUND");
    errors.push("No health endpoint found in src/ (expected /health or /healthz route)");
  }

  // Check 2: Structured logging
  const loggingResult = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.js" -E "(import|require).*\\b(pino|winston|bunyan)\\b|createLogger|new Logger\\(" src/`,
    config.cwd,
    10_000,
  );

  const hasStructuredLogging =
    loggingResult.exitCode === 0 && loggingResult.stdout.trim().length > 0;
  if (hasStructuredLogging) {
    details.push("Structured logging: FOUND");
  } else {
    details.push("Structured logging: NOT FOUND (warning - consider adding pino/winston)");
  }

  // Check 3: Error logging
  const errorLoggingResult = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.js" -E "\\.(error|warn)\\s*\\(" src/`,
    config.cwd,
    10_000,
  );

  const hasErrorLogging =
    errorLoggingResult.exitCode === 0 && errorLoggingResult.stdout.trim().length > 0;
  if (hasErrorLogging) {
    details.push("Error logging: FOUND");
  } else {
    details.push("Error logging: NOT FOUND (warning - consider adding error logging in catch blocks)");
  }

  return {
    passed: hasHealthEndpoint,
    verifier: "observability",
    details,
    errors,
  };
};
