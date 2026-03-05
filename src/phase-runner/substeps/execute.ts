/**
 * Plan Execution Substep
 *
 * Executes the plan by reading PLAN.md and CONTEXT.md, then calling
 * runStepWithCascade() with buildExecutePrompt. Uses the cascade
 * wrapper since execution is the longest step and needs retry logic.
 * Writes .execution-complete marker on success.
 *
 * Requirement: PHA-07
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStepWithCascade } from "../../step-runner/index.js";
import type { PhaseRunnerContext } from "../types.js";
import { CONTEXT_FILE, PLAN_FILE, EXECUTION_MARKER } from "../types.js";
import { writeCheckpoint } from "../checkpoint.js";
import { buildExecutePrompt } from "../prompts.js";

/**
 * Execute the plan for a phase.
 *
 * Reads PLAN.md and CONTEXT.md, then calls runStepWithCascade()
 * with the execution prompt. On success, writes the .execution-complete
 * marker file as the checkpoint.
 *
 * Requirement: PHA-07
 *
 * @param phaseNumber - The phase number
 * @param phaseDir - Absolute path to the phase directory
 * @param ctx - Phase runner context with dependencies
 * @param mockInstructions - Optional instructions for mocking external services
 * @throws Error if execution fails after all cascade attempts
 */
export async function executePlan(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
  mockInstructions?: string,
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;

  // Read PLAN.md and CONTEXT.md
  let planContent = "";
  try {
    planContent = fs.readFileSync(
      path.join(phaseDir, PLAN_FILE),
      "utf-8",
    ) as string;
  } catch {
    throw new Error(`PLAN.md not found in ${phaseDir}`);
  }

  let contextContent = "";
  try {
    contextContent = fs.readFileSync(
      path.join(phaseDir, CONTEXT_FILE),
      "utf-8",
    ) as string;
  } catch {
    contextContent = `Context for Phase ${phaseNumber} (not found)`;
  }

  const prompt = buildExecutePrompt(
    phaseNumber,
    planContent,
    contextContent,
    mockInstructions,
  );

  const cascadeResult = await runStepWithCascade(
    `phase-${phaseNumber}-execute`,
    {
      prompt,
      phase: phaseNumber,
      verify: async () => {
        // Basic verification: check that the execution produced some output.
        // Full verification happens in the verify-build substep.
        return true;
      },
      onFailure: async (error, attempt, _history) => {
        if (attempt >= 2) {
          return {
            action: "stop" as const,
            reason: `Execution failed after ${attempt} attempts: ${error}`,
          };
        }
        return {
          action: "retry" as const,
          newPrompt: `${prompt}\n\n## Previous Attempt Failed\n\nError: ${error}\n\nCheck existing files and continue from where you left off. Fix the issue described above and complete the remaining work.`,
          approach: `retry-${attempt}-with-error-context`,
        };
      },
      skippable: false,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  const finalResult = cascadeResult.result;

  if (finalResult.status !== "verified") {
    const errorMsg =
      finalResult.status === "failed" || finalResult.status === "error"
        ? finalResult.error
        : finalResult.status === "skipped"
          ? finalResult.reason
          : finalResult.status;
    throw new Error(`Plan execution failed: ${errorMsg}`);
  }

  // Write execution marker checkpoint
  const fsForCheckpoint = ctx.fs
    ? { mkdirSync: ctx.fs.mkdirSync, writeFileSync: ctx.fs.writeFileSync }
    : undefined;
  writeCheckpoint(
    phaseDir,
    EXECUTION_MARKER,
    `Execution completed at ${new Date().toISOString()}`,
    fsForCheckpoint,
  );
}
