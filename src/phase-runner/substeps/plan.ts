/**
 * Plan Creation Substep
 *
 * Creates PLAN.md by reading CONTEXT.md and ROADMAP.md,
 * then calling runStep() with buildPlanPrompt. The agent writes
 * PLAN.md to the phase directory, which serves as the checkpoint.
 *
 * Requirement: PHA-03
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStep } from "../../step-runner/index.js";
import type { PhaseRunnerContext } from "../types.js";
import { CONTEXT_FILE, PLAN_FILE } from "../types.js";
import { buildPlanPrompt } from "../prompts.js";

/**
 * Create an execution plan for a phase.
 *
 * Reads CONTEXT.md from the phase directory and ROADMAP.md from
 * the project root, then calls runStep() with a plan creation prompt.
 *
 * Requirement: PHA-03
 *
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @param requirementIds - Requirement IDs this plan must cover
 * @throws Error if runStep fails or PLAN.md is not created
 */
export async function createPlan(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
  requirementIds: string[] = [],
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;

  // Read CONTEXT.md from phase directory
  let contextContent = "";
  try {
    contextContent = fs.readFileSync(
      path.join(phaseDir, CONTEXT_FILE),
      "utf-8",
    ) as string;
  } catch {
    contextContent = `Context for Phase ${phaseNumber} (not found)`;
  }

  // Read ROADMAP.md
  const roadmapPath = path.join(process.cwd(), ".planning", "ROADMAP.md");
  let roadmapContent = "";
  try {
    roadmapContent = fs.readFileSync(roadmapPath, "utf-8") as string;
  } catch {
    roadmapContent = `Roadmap (not found)`;
  }

  const prompt = buildPlanPrompt(
    phaseNumber,
    contextContent,
    roadmapContent,
    requirementIds,
  );

  const result = await runStep(
    `phase-${phaseNumber}-plan`,
    {
      prompt,
      phase: phaseNumber,
      verify: async () => {
        // Verify PLAN.md was created in the phase directory
        return fs.existsSync(path.join(phaseDir, PLAN_FILE));
      },
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status !== "verified") {
    throw new Error(
      `Plan creation failed: ${result.status === "failed" || result.status === "error" ? result.error : result.status}`,
    );
  }
}
