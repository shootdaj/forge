/**
 * Spec Compliance Loop
 *
 * Verifies every requirement in the project, fixes gaps iteratively,
 * and checks convergence (gaps must decrease each round).
 *
 * This is the Wave 3+ mechanism that ensures the built project
 * actually satisfies all requirements.
 *
 * Requirements: PIPE-07, PIPE-08
 */

import type { PipelineContext, SpecComplianceResult } from "./types.js";
import { runStep } from "../step-runner/step-runner.js";
import { buildComplianceGapPrompt } from "./prompts.js";

/**
 * Check whether the gap history indicates convergence.
 *
 * Pure function: takes the array of gap counts per round and determines
 * if gaps are decreasing (converging toward zero).
 *
 * Rules:
 * - Single entry beyond baseline (i.e., length 2): always converging
 *   (first round result compared against baseline)
 * - Latest count strictly less than previous: converging
 * - Latest count >= previous: not converging (stuck or worsening)
 *
 * Requirement: PIPE-08
 *
 * @param gapHistory - Array where index 0 is baseline (total requirements),
 *                     subsequent entries are gap counts per round
 * @returns Object with converging flag and reason
 */
export function checkConvergence(gapHistory: number[]): {
  converging: boolean;
  reason: string;
} {
  if (gapHistory.length < 2) {
    return { converging: true, reason: "Not enough data to determine convergence" };
  }

  // First round (length === 2) is always "converging" vs baseline
  if (gapHistory.length === 2) {
    const baseline = gapHistory[0];
    const current = gapHistory[1];
    if (current === 0) {
      return { converging: true, reason: "All gaps resolved" };
    }
    if (current < baseline) {
      return {
        converging: true,
        reason: `First round: ${current} gaps (down from ${baseline} baseline)`,
      };
    }
    // Even if first round didn't improve, we allow it since it's the first comparison
    return {
      converging: true,
      reason: `First round: ${current} gaps vs ${baseline} baseline`,
    };
  }

  // For subsequent rounds: latest must be strictly less than previous
  const previous = gapHistory[gapHistory.length - 2];
  const latest = gapHistory[gapHistory.length - 1];

  if (latest === 0) {
    return { converging: true, reason: "All gaps resolved" };
  }

  if (latest < previous) {
    return {
      converging: true,
      reason: `Gaps decreased from ${previous} to ${latest}`,
    };
  }

  if (latest === previous) {
    return {
      converging: false,
      reason: `Gaps stuck at ${latest} (same as previous round)`,
    };
  }

  return {
    converging: false,
    reason: `Gaps increased from ${previous} to ${latest}`,
  };
}

/**
 * Verify whether a specific requirement is met in the codebase.
 *
 * Uses runStep with structured output to ask the agent to check
 * whether the requirement is satisfied.
 *
 * Requirement: PIPE-07
 *
 * @param requirementId - The requirement ID to verify
 * @param ctx - Pipeline context with step runner dependencies
 * @returns Object with passed flag and gap description
 */
export async function verifyRequirement(
  requirementId: string,
  ctx: PipelineContext,
): Promise<{ passed: boolean; gapDescription: string }> {
  const outputSchema = {
    type: "object" as const,
    properties: {
      passed: {
        type: "boolean" as const,
        description: "Whether the requirement is fully met",
      },
      gapDescription: {
        type: "string" as const,
        description:
          "Description of what is missing or failing. Empty string if passed.",
      },
    },
    required: ["passed", "gapDescription"],
  };

  const result = await runStep(
    `verify-requirement-${requirementId}`,
    {
      prompt: [
        `Verify whether requirement ${requirementId} is fully implemented and working.`,
        "",
        "Check the codebase for:",
        "1. Implementation code that addresses the requirement",
        "2. Tests that verify the requirement behavior",
        "3. No obvious bugs or missing edge cases",
        "",
        "Return a JSON object with:",
        '- passed: true if the requirement is fully met, false otherwise',
        '- gapDescription: description of what is missing (empty string if passed)',
      ].join("\n"),
      verify: async () => true, // Verification is done via structured output
      outputSchema,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  // Extract structured output from verified results
  if (result.status === "verified" && result.structuredOutput) {
    const output = result.structuredOutput as {
      passed: boolean;
      gapDescription: string;
    };
    return {
      passed: Boolean(output.passed),
      gapDescription: output.gapDescription ?? "",
    };
  }

  // If step failed or didn't produce structured output, treat as gap
  return {
    passed: false,
    gapDescription: `Verification step failed: ${result.status === "verified" ? "no structured output" : result.status}`,
  };
}

/**
 * Run the spec compliance loop.
 *
 * Iteratively verifies all requirements and fixes gaps until either:
 * - All requirements pass (converged)
 * - Gaps stop decreasing (not converging)
 * - Max rounds exhausted
 *
 * Implements the loop from SPEC.md lines 534-598.
 *
 * Requirements: PIPE-07, PIPE-08
 *
 * @param requirementIds - Array of requirement IDs to verify
 * @param ctx - Pipeline context with all dependencies
 * @returns SpecComplianceResult with convergence status
 */
export async function runSpecComplianceLoop(
  requirementIds: string[],
  ctx: PipelineContext,
): Promise<SpecComplianceResult> {
  const maxRounds = ctx.config.maxComplianceRounds;

  // Seed gapHistory with baseline (total requirements)
  const gapHistory: number[] = [requirementIds.length];

  // Update state: entering wave 3
  try {
    await ctx.stateManager.update((state) => ({
      ...state,
      status: "wave_3" as const,
      specCompliance: {
        ...state.specCompliance,
        totalRequirements: requirementIds.length,
        gapHistory: [...gapHistory],
        roundsCompleted: 0,
      },
    }));
  } catch {
    // Non-critical: state update failure doesn't block compliance loop
  }

  for (let round = 1; round <= maxRounds; round++) {
    // Verify each requirement
    const gaps: Array<{ id: string; description: string }> = [];

    for (const reqId of requirementIds) {
      const result = await verifyRequirement(reqId, ctx);
      if (!result.passed) {
        gaps.push({ id: reqId, description: result.gapDescription });
      }
    }

    // Record gap count for this round
    gapHistory.push(gaps.length);

    // Update state with round results
    const verified = requirementIds.length - gaps.length;
    try {
      await ctx.stateManager.update((state) => ({
        ...state,
        specCompliance: {
          ...state.specCompliance,
          gapHistory: [...gapHistory],
          verified,
          roundsCompleted: round,
        },
        remainingGaps: gaps.map((g) => g.id),
      }));
    } catch {
      // Non-critical state update failure
    }

    // All requirements pass
    if (gaps.length === 0) {
      return {
        converged: true,
        roundsCompleted: round,
        gapHistory,
        remainingGaps: [],
      };
    }

    // Check convergence (skip for first round -- always proceed)
    if (round > 1) {
      const convergence = checkConvergence(gapHistory);
      if (!convergence.converging) {
        return {
          converged: false,
          roundsCompleted: round,
          gapHistory,
          remainingGaps: gaps.map((g) => g.id),
        };
      }
    }

    // Fix each gap
    for (const gap of gaps) {
      const fixPrompt = buildComplianceGapPrompt(gap.id, gap.description, round);
      await runStep(
        `fix-gap-${gap.id}-round-${round}`,
        {
          prompt: fixPrompt,
          verify: async () => true, // Gap fix verified in next round
        },
        ctx.stepRunnerContext,
        ctx.costController,
      );
    }
  }

  // Exhausted max rounds without full convergence
  const finalGaps = gapHistory[gapHistory.length - 1];
  const remainingGaps: string[] = [];

  // Re-verify to get the latest gap list
  for (const reqId of requirementIds) {
    const result = await verifyRequirement(reqId, ctx);
    if (!result.passed) {
      remainingGaps.push(reqId);
    }
  }

  return {
    converged: false,
    roundsCompleted: maxRounds,
    gapHistory,
    remainingGaps,
  };
}
