/**
 * Context Gathering Substep
 *
 * Gathers phase context by reading ROADMAP.md to get the phase goal,
 * then calls runStep() with buildContextPrompt. The agent writes
 * CONTEXT.md to the phase directory, which serves as the checkpoint.
 *
 * Requirement: PHA-02
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStep } from "../../step-runner/index.js";
import type { PhaseRunnerContext } from "../types.js";
import { CONTEXT_FILE } from "../types.js";
import { buildContextPrompt } from "../prompts.js";
import type { CostController } from "../../step-runner/cost-controller.js";

/**
 * Gather context for a phase.
 *
 * Reads ROADMAP.md to extract the phase goal and requirement IDs,
 * then calls runStep() with a context-gathering prompt. The agent
 * writes CONTEXT.md to the phase directory.
 *
 * Requirement: PHA-02
 *
 * @param phaseNumber - The phase number to gather context for
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @throws Error if runStep fails or CONTEXT.md is not created
 */
export async function gatherContext(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;

  // Read ROADMAP.md to get phase goal
  const roadmapPath = path.join(
    ctx.config.maxBudgetTotal >= 0 ? process.cwd() : process.cwd(),
    ".planning",
    "ROADMAP.md",
  );
  let roadmapContent = "";
  try {
    roadmapContent = fs.readFileSync(roadmapPath, "utf-8") as string;
  } catch {
    roadmapContent = `Phase ${phaseNumber} (roadmap not found)`;
  }

  // Extract phase goal from roadmap
  const phaseGoal = extractPhaseGoal(roadmapContent, phaseNumber);

  const deploymentTarget = ctx.config.deployment?.target;
  const prompt = buildContextPrompt(phaseNumber, phaseGoal, roadmapContent, phaseDir, deploymentTarget);

  const result = await runStep(
    `phase-${phaseNumber}-context`,
    {
      prompt,
      phase: phaseNumber,
      verify: async () => {
        // Verify CONTEXT.md was created in the phase directory
        return fs.existsSync(path.join(phaseDir, CONTEXT_FILE));
      },
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status !== "verified") {
    throw new Error(
      `Context gathering failed: ${result.status === "failed" || result.status === "error" ? result.error : result.status}`,
    );
  }
}

/**
 * Extract the phase goal from ROADMAP.md content.
 *
 * Looks for the phase header and its **Goal** line.
 *
 * @param roadmapContent - Full ROADMAP.md content
 * @param phaseNumber - Phase number to find
 * @returns The phase goal description, or a fallback string
 */
function extractPhaseGoal(
  roadmapContent: string,
  phaseNumber: number,
): string {
  // Match "### Phase N: Name" header
  const phasePattern = new RegExp(
    `### Phase ${phaseNumber}:.*?\\n\\*\\*Goal\\*\\*:\\s*(.+?)\\n`,
    "s",
  );
  const match = roadmapContent.match(phasePattern);
  if (match) {
    return match[1].trim();
  }

  // Fallback: look for any line with Phase N
  const fallbackPattern = new RegExp(
    `Phase ${phaseNumber}[^\\n]*`,
  );
  const fallbackMatch = roadmapContent.match(fallbackPattern);
  return fallbackMatch ? fallbackMatch[0] : `Phase ${phaseNumber}`;
}
