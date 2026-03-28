/**
 * Flutter Analyze Verifier (FV-02)
 *
 * Runs dart analyze with machine-parseable output.
 * Self-skips when pubspec.yaml is absent.
 * Acquires Flutter startup lock before running.
 *
 * Requirement: FV-02, FV-05, FV-06
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";
import { withFlutterLock } from "./flutter-lock.js";

/**
 * Verify that Dart static analysis passes with no errors or warnings.
 *
 * Runs `dart analyze --fatal-warnings --format machine` in the project directory.
 * Parses machine-format output (pipe-delimited) for ERROR, WARNING, and INFO severities.
 * Skips if pubspec.yaml is not found (not a Flutter project).
 *
 * @param config - Verifier configuration with cwd and forgeConfig
 * @returns VerifierResult indicating pass, fail, or skip
 */
export const flutterAnalyzeVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("flutter-analyze", "No pubspec.yaml found");
  }

  const result = await withFlutterLock(() =>
    execWithTimeout("dart analyze --fatal-warnings --format machine", config.cwd, 60_000),
  );

  const issues = parseMachineOutput(result.stdout);

  if (result.exitCode === 0 && issues.errors === 0 && issues.warnings === 0) {
    return {
      passed: true,
      verifier: "flutter-analyze",
      details: [`dart analyze passed: ${issues.infos} info(s), 0 warning(s), 0 error(s)`],
      errors: [],
    };
  }

  return {
    passed: false,
    verifier: "flutter-analyze",
    details: [`dart analyze: ${issues.errors} error(s), ${issues.warnings} warning(s), ${issues.infos} info(s)`],
    errors: extractErrorLines(result.stdout, result.stderr),
  };
};

interface AnalyzeIssues {
  errors: number;
  warnings: number;
  infos: number;
}

/**
 * Parse dart analyze --format machine output.
 * Machine format uses pipe-delimited lines: SEVERITY|TYPE|CODE|FILE|LINE|COL|LEN|MESSAGE
 * Severity is the first field (ERROR, WARNING, or INFO).
 */
export function parseMachineOutput(stdout: string): AnalyzeIssues {
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("|")) continue;

    // Severity is the first pipe-delimited field
    const severity = trimmed.split("|")[0].trim();
    if (severity === "ERROR") errors++;
    else if (severity === "WARNING") warnings++;
    else if (severity === "INFO") infos++;
  }

  return { errors, warnings, infos };
}

function extractErrorLines(stdout: string, stderr: string): string[] {
  const output = stdout || stderr;
  if (!output.trim()) return ["dart analyze failed (no output)"];

  // Extract lines with ERROR or WARNING severity (first pipe-delimited field)
  const significant = output.split("\n").filter((line) => {
    const severity = line.trim().split("|")[0]?.trim();
    return severity === "ERROR" || severity === "WARNING";
  });

  return significant.length > 0
    ? significant.slice(0, 20)
    : output.trim().split("\n").slice(0, 20);
}
