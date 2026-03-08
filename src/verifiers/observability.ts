/**
 * Observability Verifier (VER-06)
 *
 * Checks for health endpoint, structured logging, and error logging patterns.
 * Auto-detects source directories and server frameworks.
 * Skips if the project isn't a server/service.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/** Directories that commonly contain source code. */
const SOURCE_DIRS = ["src", "app", "lib", "server", "api", "routes", "pages"];

/** Patterns that indicate a server/service (not a CLI or library). */
const SERVER_INDICATORS = [
  "express", "fastify", "hono", "koa", "next",
  "createServer", "listen(", "app.use(",
  "Deno.serve", "Bun.serve",
];

/**
 * Find source directories that exist in the project.
 */
function findSourceDirs(cwd: string): string[] {
  return SOURCE_DIRS.filter((dir) =>
    fs.existsSync(path.resolve(cwd, dir)),
  );
}

/**
 * Verify observability patterns in the project.
 *
 * Three-check heuristic:
 * a. Health endpoint: grep for /health route patterns (multiple frameworks)
 * b. Structured logging: check for pino/winston/bunyan imports
 * c. Error logging: check for .error() patterns
 *
 * Skips entirely if the project doesn't appear to be a server/service.
 * Only fails on missing health endpoint for server projects.
 *
 * Requirement: VER-06
 */
export const observabilityVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const sourceDirs = findSourceDirs(config.cwd);
  if (sourceDirs.length === 0) {
    return skippedResult("observability", "No source directories found");
  }

  const dirsArg = sourceDirs.join(" ");

  // First check if this is even a server project
  const serverCheck = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "${SERVER_INDICATORS.join("|")}" ${dirsArg} 2>/dev/null`,
    config.cwd,
    10_000,
  );

  const isServerProject = serverCheck.exitCode === 0 && serverCheck.stdout.trim().length > 0;
  if (!isServerProject) {
    return skippedResult("observability", "Project does not appear to be a server/service");
  }

  const details: string[] = [];
  const errors: string[] = [];

  // Check 1: Health endpoint (supports Express, Fastify, Hono, Koa, Next.js API routes, etc.)
  const healthPatterns = [
    "/health",
    "/healthz",
    "/api/health",
    "healthCheck",
    "healthcheck",
    "health-check",
  ].join("|");

  const healthResult = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "${healthPatterns}" ${dirsArg} 2>/dev/null`,
    config.cwd,
    10_000,
  );

  const hasHealthEndpoint = healthResult.exitCode === 0 && healthResult.stdout.trim().length > 0;
  if (hasHealthEndpoint) {
    const files = healthResult.stdout.trim().split("\n").slice(0, 3);
    details.push(`Health endpoint: FOUND (${files.join(", ")})`);
  } else {
    details.push("Health endpoint: NOT FOUND");
    errors.push("No health endpoint found (expected /health or /healthz route)");
  }

  // Check 2: Structured logging
  const loggingResult = await execWithTimeout(
    `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "(import|require).*(pino|winston|bunyan|consola)|createLogger|new Logger\\(" ${dirsArg} 2>/dev/null`,
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
    `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "\\.(error|warn)\\s*\\(" ${dirsArg} 2>/dev/null`,
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
