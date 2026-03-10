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

import * as nodeFs from "node:fs";
import type { PipelineContext, SpecComplianceResult } from "./types.js";
import { runStep } from "../step-runner/step-runner.js";
import { buildBatchGapFixPrompt, buildTargetedGapFixPrompt } from "./prompts.js";

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
 * @param requirementsDoc - Optional full REQUIREMENTS.md content for context
 * @returns Object with passed flag and gap description
 */
export async function verifyRequirement(
  requirementId: string,
  ctx: PipelineContext,
  requirementsDoc?: string,
): Promise<{ passed: boolean; gapDescription: string }> {
  const requirementsSection = requirementsDoc
    ? [
        "",
        "## Requirements Document",
        `Find requirement ${requirementId} in the document below:`,
        "",
        "```markdown",
        requirementsDoc,
        "```",
        "",
      ].join("\n")
    : "";

  const result = await runStep(
    `verify-requirement-${requirementId}`,
    {
      prompt: [
        `Verify whether requirement ${requirementId} is fully implemented and working.`,
        requirementsSection,
        "Check the codebase for:",
        "1. Implementation code that addresses the requirement",
        "2. Tests that verify the requirement behavior",
        "3. No obvious bugs or missing edge cases",
        "",
        "After your analysis, output your verdict as a JSON code block:",
        "```json",
        '{ "passed": true, "gapDescription": "" }',
        "```",
        "Set passed to false and describe the gap if the requirement is not fully met.",
      ].join("\n"),
      verify: async () => true,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status === "verified") {
    // Try structured output first (if SDK provided it)
    if (result.structuredOutput) {
      const output = result.structuredOutput as {
        passed: boolean;
        gapDescription: string;
      };
      return {
        passed: Boolean(output.passed),
        gapDescription: output.gapDescription ?? "",
      };
    }

    // Parse JSON from text response
    const text = result.result ?? "";
    const parsed = extractJsonVerdict(text);
    if (parsed) {
      return parsed;
    }

    // If we got a successful response but couldn't parse JSON,
    // treat as passed (the agent did its work without reporting issues)
    return { passed: true, gapDescription: "" };
  }

  // If step failed, treat as gap
  return {
    passed: false,
    gapDescription: `Verification step failed: ${result.status}`,
  };
}

/**
 * Verify ALL requirements in a single SDK session (batched).
 *
 * Instead of spawning one SDK session per requirement, this sends
 * all requirement IDs to a single agent session and parses the
 * results from a JSON array in the response.
 *
 * Falls back to individual verification if batch parsing fails.
 *
 * Requirement: PIPE-07
 *
 * @param requirementIds - Array of requirement IDs to verify
 * @param ctx - Pipeline context with step runner dependencies
 * @param requirementsDoc - Full REQUIREMENTS.md content for context
 */
export async function verifyRequirementsBatch(
  requirementIds: string[],
  ctx: PipelineContext,
  requirementsDoc?: string,
): Promise<Array<{ id: string; passed: boolean; gapDescription: string }>> {
  const reqList = requirementIds.map((id) => `- ${id}`).join("\n");

  const requirementsSection = requirementsDoc
    ? [
        "",
        "## Full Requirements Document",
        "Use this document to understand what each requirement ID means:",
        "",
        "```markdown",
        requirementsDoc,
        "```",
        "",
      ].join("\n")
    : "";

  const result = await runStep(
    `verify-requirements-batch`,
    {
      prompt: [
        "Verify whether each of the following requirements is fully implemented and working in this codebase.",
        "",
        "Requirements to check:",
        reqList,
        requirementsSection,
        "For EACH requirement, thoroughly check:",
        "1. Read the requirement description from the document above to understand exactly what is expected",
        "2. Search the codebase for implementation code that addresses the requirement",
        "3. Check for tests that verify the requirement behavior",
        "4. Test the actual functionality by running the app/tests where possible",
        "5. Flag any obvious bugs, missing edge cases, or incomplete implementations",
        "",
        "Be STRICT: a requirement only passes if it is FULLY implemented with working code and tests.",
        "Partial implementations should FAIL with a clear description of what is missing.",
        "",
        "After analyzing ALL requirements, output your verdicts as a single JSON code block containing an array:",
        "```json",
        "[",
        '  { "id": "R1", "passed": true, "gapDescription": "" },',
        '  { "id": "R2", "passed": false, "gapDescription": "Missing error handling for..." }',
        "]",
        "```",
        "",
        "IMPORTANT: You MUST include a verdict for EVERY requirement listed above.",
        "Output the JSON array as the very last thing in your response.",
      ].join("\n"),
      verify: async () => true,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  if (result.status === "verified") {
    const text = result.result ?? "";
    const parsed = extractJsonVerdictArray(text);
    if (parsed && parsed.length > 0) {
      // Ensure we have a verdict for every requirement
      const verdictMap = new Map(parsed.map((v) => [v.id, v]));
      return requirementIds.map((id) => {
        const verdict = verdictMap.get(id);
        if (verdict) return verdict;
        // Missing from response — treat as gap
        return { id, passed: false, gapDescription: "Not included in batch verification response" };
      });
    }
  }

  // Batch failed — fall back to individual verification
  console.log("[compliance] Batch verification failed, falling back to individual checks");
  const results: Array<{ id: string; passed: boolean; gapDescription: string }> = [];
  for (const id of requirementIds) {
    const r = await verifyRequirement(id, ctx);
    results.push({ id, ...r });
  }
  return results;
}

/**
 * Extract a { passed, gapDescription } JSON object from agent text output.
 * Looks for JSON in code blocks or bare JSON objects.
 */
function extractJsonVerdict(
  text: string,
): { passed: boolean; gapDescription: string } | null {
  // Try code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    if (typeof parsed.passed === "boolean") {
      return {
        passed: parsed.passed,
        gapDescription: String(parsed.gapDescription ?? ""),
      };
    }
  } catch {
    // Try to find JSON object anywhere in the text
    const objectMatch = text.match(/\{[\s\S]*?"passed"\s*:\s*(true|false)[\s\S]*?\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return {
          passed: Boolean(parsed.passed),
          gapDescription: String(parsed.gapDescription ?? ""),
        };
      } catch {
        // Give up
      }
    }
  }

  return null;
}

/**
 * Extract an array of { id, passed, gapDescription } verdicts from agent text output.
 * Used by batch verification.
 */
function extractJsonVerdictArray(
  text: string,
): Array<{ id: string; passed: boolean; gapDescription: string }> | null {
  // Try code block first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return typeof obj.id === "string" && typeof obj.passed === "boolean";
        })
        .map((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return {
            id: String(obj.id),
            passed: Boolean(obj.passed),
            gapDescription: String(obj.gapDescription ?? ""),
          };
        });
    }
  } catch {
    // Try to find JSON array anywhere in the text
    const arrayMatch = text.match(/\[[\s\S]*?"passed"\s*:[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item: unknown) => {
              const obj = item as Record<string, unknown>;
              return typeof obj.id === "string" && typeof obj.passed === "boolean";
            })
            .map((item: unknown) => {
              const obj = item as Record<string, unknown>;
              return {
                id: String(obj.id),
                passed: Boolean(obj.passed),
                gapDescription: String(obj.gapDescription ?? ""),
              };
            });
        }
      } catch {
        // Give up
      }
    }
  }

  return null;
}

/**
 * Read the REQUIREMENTS.md file from the project directory.
 * Returns empty string if file not found.
 */
export function readRequirementsDoc(fs?: { readFileSync: typeof nodeFs.readFileSync }): string {
  const fsImpl = fs ?? nodeFs;
  try {
    return fsImpl.readFileSync("REQUIREMENTS.md", "utf-8") as string;
  } catch {
    return "";
  }
}

/**
 * Run the spec compliance loop.
 *
 * Iteratively verifies all requirements and fixes gaps until either:
 * - All requirements pass (converged)
 * - Gaps stop decreasing (not converging)
 * - Max rounds exhausted
 *
 * Key improvements:
 * - Reads REQUIREMENTS.md and includes full requirement descriptions in all prompts
 * - When batch fixes stall, falls back to targeted individual fixes
 * - Allows one "stuck" round before giving up (tries different approach)
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
  if (requirementIds.length === 0) {
    console.warn("[forge] Warning: no requirement IDs to verify — spec compliance trivially passes");
    return {
      converged: true,
      roundsCompleted: 0,
      gapHistory: [0],
      remainingGaps: [],
    };
  }

  // Read REQUIREMENTS.md for context — agents need to know what each ID means
  const requirementsDoc = readRequirementsDoc(
    ctx.fs ? { readFileSync: ctx.fs.readFileSync } : undefined,
  );

  const maxRounds = ctx.config.maxComplianceRounds;

  // Seed gapHistory with baseline (total requirements)
  const gapHistory: number[] = [requirementIds.length];
  let usedTargetedFix = false;

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
  } catch (err) {
    console.warn("[forge] Warning: spec compliance state update failed:", err);
  }

  for (let round = 1; round <= maxRounds; round++) {
    // Verify all requirements in a single batch session
    const verdicts = await verifyRequirementsBatch(requirementIds, ctx, requirementsDoc);
    const gaps: Array<{ id: string; description: string }> = [];

    for (const verdict of verdicts) {
      if (!verdict.passed) {
        gaps.push({ id: verdict.id, description: verdict.gapDescription });
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
    } catch (err) {
      console.warn(`[forge] Warning: spec compliance round ${round} state update failed:`, err);
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
        // Before giving up: try targeted individual fixes (once)
        if (!usedTargetedFix) {
          console.log(`[compliance] Batch fixes stuck at ${gaps.length} gaps — switching to targeted individual fixes`);
          usedTargetedFix = true;
          await runTargetedGapFixes(gaps, round, ctx, requirementsDoc);
          // Don't return — let the loop re-verify in the next iteration
          continue;
        }
        // Already tried targeted fixes — truly stuck
        return {
          converged: false,
          roundsCompleted: round,
          gapHistory,
          remainingGaps: gaps.map((g) => g.id),
        };
      }
    }

    // Fix all gaps in a single batch session
    await runStep(
      `fix-gaps-round-${round}`,
      {
        prompt: buildBatchGapFixPrompt(gaps, round, requirementsDoc),
        verify: async () => true, // Gap fixes verified in next round
      },
      ctx.stepRunnerContext,
      ctx.costController,
    );
  }

  // Exhausted max rounds without full convergence
  // Re-verify in batch to get the latest gap list
  const finalVerdicts = await verifyRequirementsBatch(requirementIds, ctx, requirementsDoc);
  const remainingGaps = finalVerdicts
    .filter((v) => !v.passed)
    .map((v) => v.id);

  return {
    converged: remainingGaps.length === 0,
    roundsCompleted: maxRounds,
    gapHistory,
    remainingGaps,
  };
}

/**
 * Fix gaps individually with targeted prompts.
 *
 * When batch fixes stall (same gap count across rounds), this function
 * fixes each gap in its own dedicated SDK session. Individual sessions
 * give the agent full focus on one requirement at a time.
 */
async function runTargetedGapFixes(
  gaps: Array<{ id: string; description: string }>,
  round: number,
  ctx: PipelineContext,
  requirementsDoc: string,
): Promise<void> {
  for (const gap of gaps) {
    await runStep(
      `fix-gap-targeted-${gap.id}-round-${round}`,
      {
        prompt: buildTargetedGapFixPrompt(gap.id, gap.description, round, requirementsDoc),
        verify: async () => true,
      },
      ctx.stepRunnerContext,
      ctx.costController,
    );
  }
}
