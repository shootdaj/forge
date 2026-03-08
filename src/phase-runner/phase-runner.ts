/**
 * Phase Runner - Main Orchestrator
 *
 * The checkpoint sequencer that executes the full phase lifecycle:
 * context -> plan -> verify-plan -> execute -> verify-build -> gap-closure -> docs
 *
 * Each substep is skipped if its checkpoint file already exists (resumability).
 * State is updated at phase boundaries (in_progress at start, completed/failed/partial at end).
 *
 * Requirement: PHA-01
 */

import * as nodeFs from "node:fs";
import * as path from "node:path";
import { runStep } from "../step-runner/index.js";
import type {
  PhaseRunnerContext,
  PhaseResult,
  PhaseSubstep,
} from "./types.js";
import { PLAN_FILE } from "./types.js";
import {
  detectCheckpoints,
  resolvePhaseDir,
  getCompletedSubsteps,
} from "./checkpoint.js";
import {
  verifyPlanCoverage,
  injectTestTasks,
} from "./plan-verification.js";
import { buildReplanPrompt } from "./prompts.js";
import { gatherContext } from "./substeps/context.js";
import { createPlan } from "./substeps/plan.js";
import { executePlan } from "./substeps/execute.js";
import { verifyBuild } from "./substeps/verify-build.js";
import { runGapClosure } from "./substeps/gap-closure.js";
import { fillTestGaps } from "./substeps/test-gaps.js";
import { generatePhaseReport } from "./substeps/docs.js";

/**
 * Options for running a phase.
 */
export interface RunPhaseOptions {
  /** Optional mock instructions for external services */
  mockInstructions?: string;
  /** Requirement IDs this phase must cover */
  requirementIds?: string[];
}

/**
 * Execute the full phase lifecycle with checkpoint-based resumability.
 *
 * This is the main entry point for the phase runner. It sequences all
 * substeps, skipping completed ones based on checkpoint files, and
 * updates state at phase boundaries.
 *
 * Lifecycle:
 * 1. Context gathering -> CONTEXT.md
 * 2. Plan creation -> PLAN.md
 * 3. Plan verification (always runs -- idempotent)
 * 4. Execution -> .execution-complete
 * 5. Verification -> VERIFICATION.md
 * 6. Gap closure (if verification fails) -> GAPS.md
 * 7. Documentation -> PHASE_REPORT.md
 *
 * Requirement: PHA-01
 *
 * @param phaseNumber - The phase number to execute
 * @param ctx - Phase runner context with all dependencies
 * @param options - Optional configuration (mock instructions, requirement IDs)
 * @returns PhaseResult indicating success, failure, or partial completion
 */
export async function runPhase(
  phaseNumber: number,
  ctx: PhaseRunnerContext,
  options?: RunPhaseOptions,
): Promise<PhaseResult> {
  const fs = ctx.fs ?? nodeFs;
  const completedSubsteps: PhaseSubstep[] = [];

  // 1. Resolve phase directory
  const fsForDir = ctx.fs
    ? { mkdirSync: ctx.fs.mkdirSync }
    : undefined;
  const phaseDir = resolvePhaseDir(phaseNumber, undefined, fsForDir);

  // 2. Detect existing checkpoints
  const checkpoints = detectCheckpoints(
    phaseDir,
    ctx.fs ? { existsSync: ctx.fs.existsSync } : undefined,
  );
  const alreadyCompleted = getCompletedSubsteps(checkpoints);
  completedSubsteps.push(...alreadyCompleted);

  // 3. Update state: set phase status to 'in_progress'
  try {
    await ctx.stateManager.update((state) => {
      const phaseKey = String(phaseNumber);
      const existing = state.phases[phaseKey];
      return {
        ...state,
        phases: {
          ...state.phases,
          [phaseKey]: {
            status: "in_progress" as const,
            startedAt: existing?.startedAt ?? new Date().toISOString(),
            attempts: (existing?.attempts ?? 0) + 1,
            budgetUsed: existing?.budgetUsed ?? 0,
          },
        },
      };
    });
  } catch (err) {
    console.warn(`[forge] Warning: failed to update phase ${phaseNumber} state to in_progress:`, err);
  }

  // 4. Get phase requirement IDs
  const requirementIds = options?.requirementIds ?? [];

  try {
    // 5. Context gathering (skip if contextDone)
    if (!checkpoints.contextDone) {
      await gatherContext(phaseNumber, phaseDir, ctx);
      if (!completedSubsteps.includes("context")) {
        completedSubsteps.push("context");
      }
    }

    // 6. Plan creation (skip if planDone)
    if (!checkpoints.planDone) {
      await createPlan(phaseNumber, phaseDir, ctx, requirementIds);
      if (!completedSubsteps.includes("plan")) {
        completedSubsteps.push("plan");
      }
    }

    // 7. Plan verification (always run -- idempotent)
    const planVerificationResult = await verifyAndFixPlan(
      phaseNumber,
      phaseDir,
      ctx,
      requirementIds,
    );
    if (!planVerificationResult.passed) {
      await updatePhaseState(ctx, phaseNumber, "failed");
      return {
        status: "failed",
        reason: `Plan verification failed: missing requirements [${planVerificationResult.missingRequirements.join(", ")}]`,
      };
    }
    if (!completedSubsteps.includes("verify-plan")) {
      completedSubsteps.push("verify-plan");
    }

    // 8. Execution (skip if executionDone)
    if (!checkpoints.executionDone) {
      await executePlan(
        phaseNumber,
        phaseDir,
        ctx,
        options?.mockInstructions,
      );
      if (!completedSubsteps.includes("execute")) {
        completedSubsteps.push("execute");
      }
    }

    // 9. Verification (skip if verificationDone)
    let verificationPassed = true;
    if (!checkpoints.verificationDone) {
      const report = await verifyBuild(phaseNumber, phaseDir, ctx);

      if (!completedSubsteps.includes("verify-build")) {
        completedSubsteps.push("verify-build");
      }

      // If verification fails: fill test gaps and run gap closure
      if (!report.passed) {
        // Try filling test gaps first if there are coverage issues
        const hasCoverageFailures = report.results.some(
          (r) => r.verifier === "coverage" && !r.passed,
        );
        if (hasCoverageFailures) {
          await fillTestGaps(phaseNumber, phaseDir, ctx);
        }

        // Run gap closure
        await runGapClosure(phaseNumber, phaseDir, report, ctx);

        // Re-verify after gap closure
        const postGapReport = await verifyBuild(phaseNumber, phaseDir, ctx);
        verificationPassed = postGapReport.passed;
      }

      if (!completedSubsteps.includes("gap-closure")) {
        completedSubsteps.push("gap-closure");
      }
    } else if (!checkpoints.gapsDone) {
      // Verification was done in a prior run but gaps weren't closed
      // This case is handled by re-running verification in the gap closure path
    }

    // 11. Documentation (skip if reportDone)
    if (!checkpoints.reportDone) {
      await generatePhaseReport(phaseNumber, phaseDir, ctx);
      if (!completedSubsteps.includes("docs")) {
        completedSubsteps.push("docs");
      }
    }

    // 12. Update state based on verification result
    if (!verificationPassed) {
      await updatePhaseState(ctx, phaseNumber, "partial");
      return {
        status: "partial",
        completedSubsteps,
        lastError: "Verification failed after gap closure",
      };
    }

    await updatePhaseState(ctx, phaseNumber, "completed");

    // 13. Return success
    const reportPath = path.join(phaseDir, "PHASE_REPORT.md");
    return {
      status: "completed",
      report: reportPath,
    };
  } catch (error) {
    // Error in any substep: update state to 'partial'
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await updatePhaseState(ctx, phaseNumber, "partial");

    return {
      status: "partial",
      completedSubsteps,
      lastError: errorMessage,
    };
  }
}

/**
 * Verify and fix the plan before execution.
 *
 * Checks requirement coverage and test task presence. If test tasks
 * are missing, injects them. If requirements are missing, triggers
 * re-planning (max 1 attempt).
 *
 * Requirements: PHA-04, PHA-05, PHA-06
 *
 * @returns The final plan verification result
 */
async function verifyAndFixPlan(
  phaseNumber: number,
  phaseDir: string,
  ctx: PhaseRunnerContext,
  requirementIds: string[],
): Promise<{ passed: boolean; missingRequirements: string[] }> {
  const fs = ctx.fs ?? nodeFs;
  const planPath = path.join(phaseDir, PLAN_FILE);

  // Read current plan
  let planContent = "";
  try {
    planContent = fs.readFileSync(planPath, "utf-8") as string;
  } catch {
    return { passed: false, missingRequirements: requirementIds };
  }

  // Run plan verification
  let result = verifyPlanCoverage(planContent, requirementIds);

  // Inject test tasks if missing
  if (!result.hasTestTasks && result.missingTestTasks.length > 0) {
    planContent = injectTestTasks(planContent, result.missingTestTasks);
    fs.writeFileSync(planPath, planContent, "utf-8");
    result = verifyPlanCoverage(planContent, requirementIds);
  }

  // If requirements are still missing, re-plan (max 1 attempt)
  if (result.missingRequirements.length > 0) {
    // Read context for re-planning prompt
    let contextContent = "";
    try {
      contextContent = fs.readFileSync(
        path.join(phaseDir, "CONTEXT.md"),
        "utf-8",
      ) as string;
    } catch {
      contextContent = "";
    }

    const replanPrompt = buildReplanPrompt(
      phaseNumber,
      contextContent,
      result.missingRequirements,
      `Plan is missing coverage for these requirements: ${result.missingRequirements.join(", ")}`,
      phaseDir,
    );

    // Attempt re-plan
    const replanResult = await runStep(
      `phase-${phaseNumber}-replan`,
      {
        prompt: replanPrompt,
        phase: phaseNumber,
        verify: async () => {
          return fs.existsSync(planPath);
        },
      },
      ctx.stepRunnerContext,
      ctx.costController,
    );

    if (replanResult.status === "verified") {
      // Re-read and re-verify
      try {
        planContent = fs.readFileSync(planPath, "utf-8") as string;
        result = verifyPlanCoverage(planContent, requirementIds);
      } catch {
        return { passed: false, missingRequirements: requirementIds };
      }
    }
  }

  return {
    passed: result.passed,
    missingRequirements: result.missingRequirements,
  };
}

/**
 * Update the phase state in the state manager.
 */
async function updatePhaseState(
  ctx: PhaseRunnerContext,
  phaseNumber: number,
  status: "in_progress" | "completed" | "failed" | "partial",
): Promise<void> {
  try {
    await ctx.stateManager.update((state) => {
      const phaseKey = String(phaseNumber);
      const existing = state.phases[phaseKey];
      return {
        ...state,
        phases: {
          ...state.phases,
          [phaseKey]: {
            ...existing,
            status,
            completedAt:
              status === "completed" || status === "failed"
                ? new Date().toISOString()
                : existing?.completedAt,
            startedAt: existing?.startedAt ?? new Date().toISOString(),
            attempts: existing?.attempts ?? 1,
            budgetUsed: existing?.budgetUsed ?? 0,
          },
        },
      };
    });
  } catch (err) {
    console.warn(`[forge] Warning: failed to update phase ${phaseNumber} state to ${status}:`, err);
  }
}
