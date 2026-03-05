/**
 * Gap Closure Substep
 *
 * Diagnoses root cause of verification failures and executes targeted
 * fixes. Limited to MAX_GAP_CLOSURE_ROUNDS to prevent infinite loops.
 *
 * Flow per round:
 * 1. diagnoseFailures() -- structured output via runStep with outputSchema
 * 2. executeTargetedFix() -- focused fix via runStepWithCascade
 * 3. Re-verify via runVerifiers()
 *
 * Requirements: PHA-09, GAP-01, GAP-02, GAP-03
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStep, runStepWithCascade } from "../../step-runner/index.js";
import { runVerifiers } from "../../verifiers/index.js";
import type { VerificationReport } from "../../verifiers/types.js";
import type { PhaseRunnerContext, GapDiagnosis } from "../types.js";
import { CONTEXT_FILE, PLAN_FILE, GAPS_FILE } from "../types.js";
import { writeCheckpoint } from "../checkpoint.js";
import { buildDiagnosisPrompt, buildFixPrompt } from "../prompts.js";

/** Maximum gap closure rounds to prevent infinite loops (from CONTEXT.md, locked) */
export const MAX_GAP_CLOSURE_ROUNDS = 2;

/**
 * Gap diagnosis output schema for structured JSON extraction.
 */
const GAP_DIAGNOSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: [
        "wrong_approach",
        "missing_dependency",
        "integration_mismatch",
        "requirement_ambiguity",
        "environment_issue",
      ],
    },
    description: { type: "string" },
    affectedFiles: {
      type: "array",
      items: { type: "string" },
    },
    suggestedFix: { type: "string" },
    retestCommand: { type: "string" },
  },
  required: [
    "category",
    "description",
    "affectedFiles",
    "suggestedFix",
    "retestCommand",
  ],
};

/**
 * Run gap closure: diagnose failures, apply targeted fixes, re-verify.
 *
 * Loops for up to MAX_GAP_CLOSURE_ROUNDS rounds. Each round:
 * 1. Diagnoses the root cause with structured output
 * 2. Executes a targeted fix (not a full re-execution)
 * 3. Re-runs verifiers
 *
 * Requirements: PHA-09, GAP-01, GAP-02, GAP-03
 *
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param initialReport - The initial verification report that failed
 * @param ctx - Phase runner context with dependencies
 */
export async function runGapClosure(
  phaseNumber: number,
  phaseDir: string,
  initialReport: VerificationReport,
  ctx: PhaseRunnerContext,
): Promise<void> {
  const roundHistory: Array<{
    round: number;
    diagnosis: GapDiagnosis;
    fixApplied: boolean;
    resolved: boolean;
  }> = [];

  let currentReport = initialReport;

  for (let round = 1; round <= MAX_GAP_CLOSURE_ROUNDS; round++) {
    // 1. Diagnose root cause
    const diagnosis = await diagnoseFailures(
      currentReport,
      phaseDir,
      ctx,
    );

    // 2. Execute targeted fix
    let fixApplied = false;
    try {
      await executeTargetedFix(diagnosis, phaseNumber, phaseDir, ctx);
      fixApplied = true;
    } catch {
      fixApplied = false;
    }

    // 3. Re-verify
    const newReport = await runVerifiers({
      cwd: process.cwd(),
      forgeConfig: ctx.config,
    });

    const resolved = newReport.passed;

    roundHistory.push({
      round,
      diagnosis,
      fixApplied,
      resolved,
    });

    if (resolved) {
      // Write GAPS.md with resolution history
      const content = formatGapsReport(roundHistory, "resolved");
      const fsForCheckpoint = ctx.fs
        ? { mkdirSync: ctx.fs.mkdirSync, writeFileSync: ctx.fs.writeFileSync }
        : undefined;
      writeCheckpoint(phaseDir, GAPS_FILE, content, fsForCheckpoint);
      return;
    }

    currentReport = newReport;
  }

  // After max rounds, write GAPS.md with remaining failures
  const content = formatGapsReport(roundHistory, "unresolved");
  const fsForCheckpoint = ctx.fs
    ? { mkdirSync: ctx.fs.mkdirSync, writeFileSync: ctx.fs.writeFileSync }
    : undefined;
  writeCheckpoint(phaseDir, GAPS_FILE, content, fsForCheckpoint);
}

/**
 * Diagnose verification failures using structured output.
 *
 * Calls runStep() with buildDiagnosisPrompt and outputSchema
 * for GapDiagnosis structured output.
 *
 * Requirement: GAP-01
 *
 * @param report - The verification report showing failures
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @returns Structured GapDiagnosis
 */
export async function diagnoseFailures(
  report: VerificationReport,
  phaseDir: string,
  ctx: PhaseRunnerContext,
): Promise<GapDiagnosis> {
  const fs = ctx.fs ?? nodeFs;

  // Read plan and context for the diagnosis prompt
  let planContent = "";
  try {
    planContent = fs.readFileSync(
      path.join(phaseDir, PLAN_FILE),
      "utf-8",
    ) as string;
  } catch {
    planContent = "(plan not available)";
  }

  let contextContent = "";
  try {
    contextContent = fs.readFileSync(
      path.join(phaseDir, CONTEXT_FILE),
      "utf-8",
    ) as string;
  } catch {
    contextContent = "(context not available)";
  }

  // Format the verification report as a string
  const reportStr = formatReportForDiagnosis(report);

  const prompt = buildDiagnosisPrompt(reportStr, planContent, contextContent);

  const result = await runStep(
    `gap-diagnosis`,
    {
      prompt,
      verify: async () => true, // Diagnosis itself always "passes" -- it's the output we care about
      outputSchema: GAP_DIAGNOSIS_SCHEMA,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status === "verified" && result.structuredOutput) {
    return result.structuredOutput as GapDiagnosis;
  }

  // Fallback diagnosis if structured output fails
  return {
    category: "environment_issue",
    description: "Unable to diagnose root cause -- structured output extraction failed",
    affectedFiles: [],
    suggestedFix: "Review verification report manually and apply fixes",
    retestCommand: "npm test",
  };
}

/**
 * Execute a targeted fix based on a diagnosis.
 *
 * Calls runStepWithCascade() with buildFixPrompt. Uses limited
 * retries (maxRetries: 1) since gap closure is itself a retry mechanism.
 *
 * Requirements: GAP-02, GAP-03
 *
 * @param diagnosis - The root cause diagnosis
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 */
export async function executeTargetedFix(
  diagnosis: GapDiagnosis,
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;

  let planContent = "";
  try {
    planContent = fs.readFileSync(
      path.join(phaseDir, PLAN_FILE),
      "utf-8",
    ) as string;
  } catch {
    planContent = "(plan not available)";
  }

  const prompt = buildFixPrompt(diagnosis, planContent);

  const cascadeResult = await runStepWithCascade(
    `gap-fix-${diagnosis.category}`,
    {
      prompt,
      phase: phaseNumber,
      verify: async () => true, // Verification happens via re-running verifiers after fix
      onFailure: async (error, attempt) => {
        if (attempt >= 1) {
          return {
            action: "stop" as const,
            reason: `Targeted fix failed: ${error}`,
          };
        }
        return {
          action: "retry" as const,
          newPrompt: `${prompt}\n\nPrevious fix attempt failed: ${error}\n\nTry a different approach.`,
          approach: "alternative-fix",
        };
      },
      maxRetries: 1,
      skippable: false,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (
    cascadeResult.result.status !== "verified" &&
    cascadeResult.result.status !== "skipped"
  ) {
    const errorMsg =
      cascadeResult.result.status === "failed" ||
      cascadeResult.result.status === "error"
        ? cascadeResult.result.error
        : cascadeResult.result.status;
    throw new Error(`Targeted fix failed: ${errorMsg}`);
  }
}

/**
 * Format a verification report as a readable string for the diagnosis prompt.
 */
function formatReportForDiagnosis(report: VerificationReport): string {
  const lines: string[] = [
    `Overall: ${report.passed ? "PASSED" : "FAILED"}`,
    `Passed: ${report.summary.passed}, Failed: ${report.summary.failed}, Skipped: ${report.summary.skipped}`,
    "",
  ];

  for (const result of report.results) {
    if (!result.passed) {
      lines.push(`FAILED: ${result.verifier}`);
      for (const error of result.errors) {
        lines.push(`  - ${error}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Format gap closure history as GAPS.md content.
 */
function formatGapsReport(
  history: Array<{
    round: number;
    diagnosis: GapDiagnosis;
    fixApplied: boolean;
    resolved: boolean;
  }>,
  status: "resolved" | "unresolved",
): string {
  const lines: string[] = [
    `# Gap Closure Report`,
    "",
    `**Status:** ${status === "resolved" ? "All gaps resolved" : "Gaps remaining after max rounds"}`,
    `**Rounds:** ${history.length}/${MAX_GAP_CLOSURE_ROUNDS}`,
    "",
  ];

  for (const entry of history) {
    lines.push(`## Round ${entry.round}`);
    lines.push("");
    lines.push(`- **Category:** ${entry.diagnosis.category}`);
    lines.push(`- **Description:** ${entry.diagnosis.description}`);
    lines.push(
      `- **Affected Files:** ${entry.diagnosis.affectedFiles.join(", ") || "none"}`,
    );
    lines.push(`- **Suggested Fix:** ${entry.diagnosis.suggestedFix}`);
    lines.push(`- **Fix Applied:** ${entry.fixApplied ? "yes" : "no"}`);
    lines.push(`- **Resolved:** ${entry.resolved ? "yes" : "no"}`);
    lines.push("");
  }

  return lines.join("\n");
}
