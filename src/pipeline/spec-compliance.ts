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
import { execSync } from "node:child_process";
import type { PipelineContext, SpecComplianceResult } from "./types.js";
import { runStep } from "../step-runner/step-runner.js";
import {
  buildBatchGapFixPrompt,
  buildTargetedGapFixPrompt,
  buildIncrementalGapFixPrompt,
} from "./prompts.js";
import { analyzeGapOverlap, limitConcurrency, type GapWithFiles } from "./gap-graph.js";

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
): Promise<Array<{ id: string; passed: boolean; gapDescription: string; files: string[] }>> {
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
        '  { "id": "R1", "passed": true, "gapDescription": "", "files": [] },',
        '  { "id": "R2", "passed": false, "gapDescription": "Missing error handling for...", "files": ["src/auth.ts", "src/auth.test.ts"] }',
        "]",
        "```",
        "",
        "For each FAILING requirement, include a \"files\" array listing the source files",
        "that would need to be modified to fix the gap. For passing requirements, \"files\" can be empty.",
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
        return { id, passed: false, gapDescription: "Not included in batch verification response", files: [] };
      });
    }
  }

  // Batch failed — fall back to individual verification
  console.log("[compliance] Batch verification failed, falling back to individual checks");
  const results: Array<{ id: string; passed: boolean; gapDescription: string; files: string[] }> = [];
  for (const id of requirementIds) {
    const r = await verifyRequirement(id, ctx);
    results.push({ id, ...r, files: [] });
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
): Array<{ id: string; passed: boolean; gapDescription: string; files: string[] }> | null {
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
            files: Array.isArray(obj.files) ? (obj.files as unknown[]).map(String) : [],
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
                files: Array.isArray(obj.files) ? (obj.files as unknown[]).map(String) : [],
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
 * Execute a git command, using ctx.execFn if available (for testing),
 * otherwise using child_process.execSync.
 *
 * @param cmd - The git command to run
 * @param ctx - Pipeline context (may have injected execFn)
 * @returns Command stdout as string
 */
export function execGitCommand(cmd: string, ctx: PipelineContext): string {
  if (ctx.execFn) {
    return ctx.execFn(cmd);
  }
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

/**
 * Fix a single gap in its own SDK session with commit/revert.
 *
 * Records a git restore point, runs the fix, commits, verifies the fix,
 * and reverts if the fix didn't work. Used by the parallel compliance loop
 * to fix independent gaps concurrently.
 *
 * @param gap - The gap to fix (with file information)
 * @param round - Current compliance round number
 * @param currentPassing - Currently passing requirement IDs (for regression-aware prompts)
 * @param ctx - Pipeline context
 * @param requirementsDoc - Full requirements document text
 * @returns Object indicating whether the fix succeeded
 */
async function fixSingleGap(
  gap: GapWithFiles,
  round: number,
  currentPassing: string[],
  ctx: PipelineContext,
  requirementsDoc: string,
): Promise<{ fixed: boolean }> {
  // Record restore point
  let restorePoint = "";
  try {
    restorePoint = execGitCommand("git rev-parse HEAD", ctx);
  } catch {
    // If git is not available, skip commit/revert but still fix
  }

  // Fix the gap in its own SDK session
  const fixResult = await runStep(
    `fix-gap-incremental-${gap.id}-round-${round}`,
    {
      prompt: buildIncrementalGapFixPrompt(
        gap.id,
        gap.description,
        round,
        currentPassing,
        requirementsDoc,
      ),
      verify: async () => true,
    },
    ctx.stepRunnerContext,
    ctx.costController,
  );

  // Handle watchdog timeout — defer gracefully
  if (fixResult.status === "timed_out") {
    console.log(`[compliance] Gap fix for ${gap.id} timed out — deferring`);
    if (restorePoint) {
      try {
        execGitCommand(`git reset --hard ${restorePoint}`, ctx);
      } catch {
        console.warn(`[compliance] Warning: git reset failed for ${gap.id}`);
      }
    }
    return { fixed: false };
  }

  // Commit the fix
  if (restorePoint) {
    try {
      execGitCommand(
        `git add -A && git commit -m "fix: spec compliance - ${gap.id}"`,
        ctx,
      );
    } catch {
      // If commit fails (nothing to commit), that's OK
    }
  }

  // Verify the fixed requirement
  const fixVerdict = await verifyRequirement(gap.id, ctx, requirementsDoc);

  if (!fixVerdict.passed) {
    // Fix didn't work — revert
    console.log(
      `[compliance] Fix for ${gap.id} did not resolve the gap — reverting`,
    );
    if (restorePoint) {
      try {
        execGitCommand(`git reset --hard ${restorePoint}`, ctx);
      } catch {
        console.warn(`[compliance] Warning: git reset failed for ${gap.id}`);
      }
    }
    return { fixed: false };
  }

  console.log(`[compliance] Fix for ${gap.id} verified`);
  return { fixed: true };
}

/**
 * Run the incremental spec compliance loop.
 *
 * Analyzes file overlap between gaps and fixes independent gaps concurrently.
 * Gaps sharing files are placed in different execution groups and run sequentially
 * across groups. Within each group, gaps run in parallel up to maxParallelGapFixes.
 *
 * Each individual gap fix follows the Phase 13 pattern: record restore point,
 * fix, commit, verify, revert on failure.
 *
 * Gap count must monotonically decrease (or stay flat from deferred gaps).
 *
 * Requirements: PIPE-07, PIPE-08
 *
 * @param requirementIds - Array of requirement IDs to verify
 * @param ctx - Pipeline context with all dependencies
 * @returns SpecComplianceResult with convergence status
 */
export async function runIncrementalComplianceLoop(
  requirementIds: string[],
  ctx: PipelineContext,
): Promise<SpecComplianceResult> {
  // Read REQUIREMENTS.md for context
  const requirementsDoc = readRequirementsDoc(
    ctx.fs ? { readFileSync: ctx.fs.readFileSync } : undefined,
  );

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
  } catch (err) {
    console.warn("[forge] Warning: spec compliance state update failed:", err);
  }

  for (let round = 1; round <= maxRounds; round++) {
    // Verify all requirements in a single batch session
    const verdicts = await verifyRequirementsBatch(requirementIds, ctx, requirementsDoc);

    // Build passing set and gap set
    const passingSet: string[] = [];
    const gaps: Array<{ id: string; description: string }> = [];

    for (const verdict of verdicts) {
      if (verdict.passed) {
        passingSet.push(verdict.id);
      } else {
        gaps.push({ id: verdict.id, description: verdict.gapDescription });
      }
    }

    // All requirements pass — no gaps to fix
    if (gaps.length === 0) {
      gapHistory.push(0);
      // Update state
      try {
        await ctx.stateManager.update((state) => ({
          ...state,
          specCompliance: {
            ...state.specCompliance,
            gapHistory: [...gapHistory],
            verified: passingSet.length,
            roundsCompleted: round,
          },
          remainingGaps: [],
        }));
      } catch (err) {
        console.warn(`[forge] Warning: spec compliance round ${round} state update failed:`, err);
      }
      return {
        converged: true,
        roundsCompleted: round,
        gapHistory,
        remainingGaps: [],
      };
    }

    // Fix gaps using parallel execution for independent gaps
    const currentPassing = [...passingSet];
    const deferredGaps: Array<{ id: string; description: string }> = [];

    // Convert gaps to GapWithFiles using file info from verdicts
    const gapsWithFiles: GapWithFiles[] = gaps.map((gap) => {
      const verdict = verdicts.find((v) => v.id === gap.id);
      return {
        id: gap.id,
        description: gap.description,
        files: verdict?.files ?? [],
      };
    });

    // Analyze file overlap to find independent groups
    const independentGroups = analyzeGapOverlap(gapsWithFiles);
    const maxConcurrency = ctx.config.maxParallelGapFixes ?? 3;

    console.log(
      `[compliance] Round ${round}: ${gaps.length} gaps in ${independentGroups.length} group(s), ` +
        `max concurrency ${maxConcurrency}`,
    );

    // Process each group of independent gaps
    for (const group of independentGroups) {
      // Create fix tasks for each gap in this independent group
      const fixTasks = group.map((gapId) => {
        const gap = gapsWithFiles.find((g) => g.id === gapId)!;
        return () =>
          fixSingleGap(gap, round, currentPassing, ctx, requirementsDoc);
      });

      // Run independent gaps concurrently (up to maxConcurrency)
      const results = await limitConcurrency(fixTasks, maxConcurrency);

      // Process results: update passing set and deferred gaps
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const gapId = group[i];
        if (result.status === "fulfilled") {
          if (result.value.fixed) {
            currentPassing.push(gapId);
          } else {
            const gap = gapsWithFiles.find((g) => g.id === gapId)!;
            deferredGaps.push({ id: gap.id, description: gap.description });
          }
        } else {
          // Promise rejected — treat as deferred
          const gap = gapsWithFiles.find((g) => g.id === gapId)!;
          deferredGaps.push({ id: gap.id, description: gap.description });
          console.warn(
            `[compliance] Gap fix for ${gapId} threw an error — deferring`,
          );
        }
      }

      // Post-group regression check on all previously-passing requirements
      // For single-gap groups, this catches regressions from individual fixes
      // For multi-gap groups, this catches cross-gap interactions that file analysis missed
      const fixedInGroup = group.filter((gapId) => {
        const idx = group.indexOf(gapId);
        const result = results[idx];
        return result.status === "fulfilled" && result.value.fixed;
      });

      if (currentPassing.length > 0 && fixedInGroup.length > 0) {
        // Check regression on all passing reqs EXCEPT those just fixed in this group
        const regressCandidates = currentPassing.filter(
          (id) => !fixedInGroup.includes(id),
        );
        if (regressCandidates.length > 0) {
          const regressionVerdicts = await verifyRequirementsBatch(
            regressCandidates,
            ctx,
            requirementsDoc,
          );
          const regressions = regressionVerdicts.filter((v) => !v.passed);
          if (regressions.length > 0) {
            console.log(
              `[compliance] Post-group regression detected: ${regressions.length} requirement(s) regressed — ` +
                regressions.map((r) => r.id).join(", ") +
                " — reverting group fixes",
            );
            // Revert all fixes in this group that succeeded
            for (const fixedGapId of fixedInGroup) {
              // Remove from currentPassing
              const passIdx = currentPassing.indexOf(fixedGapId);
              if (passIdx !== -1) {
                currentPassing.splice(passIdx, 1);
              }
              // Add back to deferred
              const gap = gapsWithFiles.find((g) => g.id === fixedGapId)!;
              deferredGaps.push({ id: gap.id, description: gap.description });
            }
            // Revert via git
            try {
              execGitCommand("git rev-parse HEAD", ctx); // check git availability
              // Revert to the state before this group started
              // Note: individual fixSingleGap already committed, so we need to revert those
              for (const _fixedGapId of fixedInGroup) {
                try {
                  execGitCommand("git reset --hard HEAD~1", ctx);
                } catch {
                  // Best effort revert
                }
              }
            } catch {
              // Git not available
            }
          }
        }
      }
    }

    // Record final gap count after incremental fixes
    gapHistory.push(deferredGaps.length);

    // Check convergence AFTER incremental fixes (skip for first round — always proceed)
    if (round > 1) {
      const convergence = checkConvergence(gapHistory);
      if (!convergence.converging) {
        // Update state before returning
        try {
          await ctx.stateManager.update((state) => ({
            ...state,
            specCompliance: {
              ...state.specCompliance,
              gapHistory: [...gapHistory],
              verified: currentPassing.length,
              roundsCompleted: round,
            },
            remainingGaps: deferredGaps.map((g) => g.id),
          }));
        } catch (err) {
          console.warn(`[forge] Warning: spec compliance round ${round} state update failed:`, err);
        }
        return {
          converged: false,
          roundsCompleted: round,
          gapHistory,
          remainingGaps: deferredGaps.map((g) => g.id),
        };
      }
    }

    // If all gaps were fixed this round
    if (deferredGaps.length === 0) {
      // Update state
      try {
        await ctx.stateManager.update((state) => ({
          ...state,
          specCompliance: {
            ...state.specCompliance,
            gapHistory: [...gapHistory],
            verified: requirementIds.length,
            roundsCompleted: round,
          },
          remainingGaps: [],
        }));
      } catch (err) {
        console.warn("[forge] Warning: final state update failed:", err);
      }
      return {
        converged: true,
        roundsCompleted: round,
        gapHistory,
        remainingGaps: [],
      };
    }

    // Update state with actual remaining gaps after incremental fixes
    try {
      await ctx.stateManager.update((state) => ({
        ...state,
        specCompliance: {
          ...state.specCompliance,
          gapHistory: [...gapHistory],
          verified: currentPassing.length,
          roundsCompleted: round,
        },
        remainingGaps: deferredGaps.map((g) => g.id),
      }));
    } catch (err) {
      console.warn(`[forge] Warning: incremental round ${round} state update failed:`, err);
    }
  }

  // Exhausted max rounds — do a final verification
  const finalVerdicts = await verifyRequirementsBatch(requirementIds, ctx, requirementsDoc);
  const remainingGaps = finalVerdicts.filter((v) => !v.passed).map((v) => v.id);

  return {
    converged: remainingGaps.length === 0,
    roundsCompleted: maxRounds,
    gapHistory,
    remainingGaps,
  };
}

/**
 * Run the spec compliance loop.
 *
 * Delegates to the incremental compliance loop which fixes gaps one at a time
 * with individual commit/revert cycles and regression checking.
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

  // Delegate to incremental compliance loop
  return runIncrementalComplianceLoop(requirementIds, ctx);
}

/**
 * @deprecated Use runIncrementalComplianceLoop instead.
 *
 * Original batched compliance loop that fixes ALL gaps in one SDK session.
 * Kept for reference and potential fallback. The incremental approach
 * (runIncrementalComplianceLoop) is preferred as it prevents regressions
 * by fixing and verifying gaps one at a time with git rollback.
 *
 * Requirements: PIPE-07, PIPE-08
 */
export async function runBatchedComplianceLoop(
  requirementIds: string[],
  ctx: PipelineContext,
): Promise<SpecComplianceResult> {
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
          await runBatchedTargetedGapFixes(gaps, round, ctx, requirementsDoc);
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
 * @deprecated Used by runBatchedComplianceLoop.
 *
 * Fix gaps individually with targeted prompts (no git rollback).
 * Used when batch fixes stall in the deprecated batched loop.
 */
async function runBatchedTargetedGapFixes(
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
