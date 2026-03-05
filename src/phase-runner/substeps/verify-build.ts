/**
 * Build Verification Substep
 *
 * Runs all programmatic verifiers from Phase 4 after plan execution.
 * Writes VERIFICATION.md with the formatted report. Returns the
 * VerificationReport for gap closure decision-making.
 *
 * Requirement: PHA-08
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runVerifiers } from "../../verifiers/index.js";
import type { VerificationReport } from "../../verifiers/types.js";
import type { PhaseRunnerContext } from "../types.js";
import { VERIFICATION_FILE } from "../types.js";
import { writeCheckpoint } from "../checkpoint.js";

/**
 * Run programmatic verifiers after plan execution.
 *
 * Calls runVerifiers() with the project configuration and writes
 * VERIFICATION.md with the formatted results.
 *
 * Requirement: PHA-08
 *
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @returns The verification report for gap closure decision
 */
export async function verifyBuild(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
): Promise<VerificationReport> {
  const report = await runVerifiers({
    cwd: process.cwd(),
    forgeConfig: ctx.config,
  });

  // Format the report as markdown
  const reportContent = formatVerificationReport(report, phaseNumber);

  // Write VERIFICATION.md checkpoint
  const fsForCheckpoint = ctx.fs
    ? { mkdirSync: ctx.fs.mkdirSync, writeFileSync: ctx.fs.writeFileSync }
    : undefined;
  writeCheckpoint(phaseDir, VERIFICATION_FILE, reportContent, fsForCheckpoint);

  return report;
}

/**
 * Format a VerificationReport as markdown content.
 *
 * @param report - The verification report to format
 * @param phaseNumber - The phase number
 * @returns Formatted markdown string
 */
function formatVerificationReport(
  report: VerificationReport,
  phaseNumber: number,
): string {
  const lines: string[] = [
    `# Phase ${phaseNumber} Verification Report`,
    "",
    `**Overall:** ${report.passed ? "PASSED" : "FAILED"}`,
    `**Duration:** ${report.durationMs}ms`,
    "",
    "## Summary",
    "",
    `- Total verifiers: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Skipped: ${report.summary.skipped}`,
    "",
    "## Results",
    "",
  ];

  for (const result of report.results) {
    lines.push(`### ${result.verifier}: ${result.passed ? "PASSED" : "FAILED"}`);
    lines.push("");

    if (result.details.length > 0) {
      for (const detail of result.details) {
        lines.push(`- ${detail}`);
      }
      lines.push("");
    }

    if (result.errors.length > 0) {
      lines.push("**Errors:**");
      for (const error of result.errors) {
        lines.push(`- ${error}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
