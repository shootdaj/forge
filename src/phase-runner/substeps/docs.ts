/**
 * Phase Documentation Substep
 *
 * Generates PHASE_REPORT.md by reading verification and gap closure
 * results, then calling runStep() with buildReportPrompt.
 *
 * This is the final substep in the phase lifecycle.
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStep } from "../../step-runner/index.js";
import type { PhaseRunnerContext } from "../types.js";
import {
  CONTEXT_FILE,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
} from "../types.js";
import { buildReportPrompt } from "../prompts.js";

/**
 * Generate the phase report.
 *
 * Reads VERIFICATION.md, GAPS.md (if exists), and CONTEXT.md,
 * then calls runStep() with buildReportPrompt. The agent writes
 * PHASE_REPORT.md to the phase directory.
 *
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @throws Error if report generation fails
 */
export async function generatePhaseReport(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;

  // Read checkpoint files
  let verificationContent = "";
  try {
    verificationContent = fs.readFileSync(
      path.join(phaseDir, VERIFICATION_FILE),
      "utf-8",
    ) as string;
  } catch {
    verificationContent = "Verification results not available.";
  }

  let gapsContent: string | null = null;
  try {
    gapsContent = fs.readFileSync(
      path.join(phaseDir, GAPS_FILE),
      "utf-8",
    ) as string;
  } catch {
    gapsContent = null; // No gaps file means no gap closure was needed
  }

  let contextContent = "";
  try {
    contextContent = fs.readFileSync(
      path.join(phaseDir, CONTEXT_FILE),
      "utf-8",
    ) as string;
  } catch {
    contextContent = `Phase ${phaseNumber} context not available.`;
  }

  const prompt = buildReportPrompt(
    phaseNumber,
    verificationContent,
    gapsContent,
    contextContent,
  );

  const result = await runStep(
    `phase-${phaseNumber}-docs`,
    {
      prompt,
      phase: phaseNumber,
      verify: async () => {
        // Verify PHASE_REPORT.md was created
        return fs.existsSync(path.join(phaseDir, REPORT_FILE));
      },
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status !== "verified") {
    throw new Error(
      `Phase report generation failed: ${result.status === "failed" || result.status === "error" ? result.error : result.status}`,
    );
  }
}
