/**
 * Pipeline Controller FSM
 *
 * The main orchestrator that composes all pipeline modules into the wave model:
 * Wave 1 (build with mocks) -> Human Checkpoint -> Wave 2 (real integrations) ->
 * Wave 3+ (spec compliance) -> UAT gate -> Deployment -> Milestone completion.
 *
 * This is the function that `forge run` (Phase 7) will call.
 *
 * Requirements: PIPE-01, PIPE-05, PIPE-06, PIPE-09, PIPE-10
 */

import { runStep } from "../step-runner/step-runner.js";
import { getExecutionWaves } from "./dependency-graph.js";
import { MockManager } from "./mock-manager.js";
import {
  needsHumanCheckpoint,
  generateCheckpointReport,
  writeCheckpointFile,
  formatCheckpointDisplay,
} from "./human-checkpoint.js";
import { runSpecComplianceLoop } from "./spec-compliance.js";
import { buildIntegrationPrompt, buildSkippedItemPrompt } from "./prompts.js";
import { runUAT } from "../uat/index.js";
import type { UATContext, UATResult } from "../uat/types.js";
import { runDeployment } from "../deployment/deployer.js";
import type { DeploymentContext } from "../deployment/types.js";

import type {
  PipelineContext,
  PipelineResult,
  PipelinePhase,
  ServiceDetection,
  SkippedItem,
  WaveResult,
  SpecComplianceResult,
} from "./types.js";
import type { PhaseRunnerContext } from "../phase-runner/types.js";
import type { ForgeState } from "../state/schema.js";

// ---------------------------------------------------------------------------
// Helper: convert PipelineContext to PhaseRunnerContext
// ---------------------------------------------------------------------------

/**
 * Build a PhaseRunnerContext from a PipelineContext.
 * They share most fields; this maps the pipeline DI container into
 * the shape the phase runner expects.
 */
function buildPhaseRunnerCtx(ctx: PipelineContext): PhaseRunnerContext {
  return {
    config: ctx.config,
    stateManager: ctx.stateManager,
    stepRunnerContext: ctx.stepRunnerContext,
    costController: ctx.costController,
    fs: ctx.fs,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full pipeline FSM.
 *
 * State transitions:
 * initializing -> wave_1 -> human_checkpoint -> wave_2 -> wave_3 -> uat -> deploying -> completed
 * Any wave can transition to "failed" on error.
 * Wave 3+ can transition to "stuck" if compliance doesn't converge.
 *
 * Requirements: PIPE-01, PIPE-05, PIPE-06, PIPE-09, PIPE-10
 *
 * @param ctx - Pipeline context with all injected dependencies
 * @returns PipelineResult discriminated union
 */
export async function runPipeline(
  ctx: PipelineContext,
): Promise<PipelineResult> {
  // =========================================================================
  // Phase 0: Initialization
  // =========================================================================

  const state = ctx.stateManager.load();

  // If already completed or failed, return immediately
  if (state.status === "completed") {
    return {
      status: "completed",
      wavesCompleted: state.currentWave,
      phasesCompleted: getCompletedPhaseNumbers(state),
      totalCostUsd: state.totalBudgetUsed,
      specCompliance: {
        converged: true,
        roundsCompleted: state.specCompliance.roundsCompleted,
        gapHistory: state.specCompliance.gapHistory,
        remainingGaps: state.remainingGaps,
      },
      deploymentUrl: state.deployment?.url || undefined,
    };
  }

  if (state.status === "failed") {
    return {
      status: "failed",
      wave: state.currentWave,
      reason: "Pipeline previously failed. Use `forge resume --from <stage>` to retry from a specific stage.",
      phasesCompletedSoFar: getCompletedPhaseNumbers(state),
      phasesFailed: getFailedPhaseNumbers(state),
    };
  }

  // If resuming from human_checkpoint, skip directly to Wave 2
  if (state.status === "human_checkpoint") {
    return await executeFromWave2(ctx, state);
  }

  // If resuming from a mid-pipeline stage, jump directly there
  if (state.status === "wave_2" || state.status === "wave_3" ||
      state.status === "uat" || state.status === "deploying") {
    return await executeFromStage(ctx, state);
  }

  // Load roadmap and parse execution waves
  const fs = ctx.fs ?? (await import("node:fs"));
  const roadmapPath = ".planning/ROADMAP.md";

  let roadmapContent: string;
  try {
    roadmapContent = fs.readFileSync(roadmapPath, "utf-8") as string;
  } catch {
    return {
      status: "failed",
      wave: 0,
      reason: `Failed to read roadmap: ${roadmapPath}`,
      phasesCompletedSoFar: [],
      phasesFailed: [],
    };
  }

  const { waves, phases } = getExecutionWaves(roadmapContent);

  if (waves.length === 0 || phases.length === 0) {
    return {
      status: "failed",
      wave: 0,
      reason: "No phases found in roadmap",
      phasesCompletedSoFar: [],
      phasesFailed: [],
    };
  }

  // Collect all requirement IDs across all phases
  const allRequirementIds = collectAllRequirementIds(phases);

  // Build lookup: phase number -> PipelinePhase
  const phaseMap = new Map<number, PipelinePhase>();
  for (const p of phases) {
    phaseMap.set(p.number, p);
  }

  // =========================================================================
  // Wave 1: Build everything with mocks (PIPE-01)
  // =========================================================================

  let wave1Result: WaveResult;
  try {
    wave1Result = await executeWave1(ctx, waves, phaseMap, state);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    await safeUpdateState(ctx, { status: "failed" });
    return {
      status: "failed",
      wave: 1,
      reason,
      phasesCompletedSoFar: getCompletedPhaseNumbers(ctx.stateManager.load()),
      phasesFailed: getFailedPhaseNumbers(ctx.stateManager.load()),
    };
  }

  // =========================================================================
  // Human Checkpoint (PIPE-04)
  // =========================================================================

  const stateAfterWave1 = ctx.stateManager.load();

  if (needsHumanCheckpoint(stateAfterWave1)) {
    await safeUpdateState(ctx, { status: "human_checkpoint" });

    const report = generateCheckpointReport(stateAfterWave1);

    try {
      writeCheckpointFile(report, "forge-checkpoint.json", ctx.fs);
    } catch {
      // Non-critical: checkpoint file write failure doesn't block pipeline
    }

    const display = formatCheckpointDisplay(report);
    // Log is informational -- the return value is what matters
    void display;

    return {
      status: "checkpoint",
      wave: 1,
      checkpointReport: report,
      phasesCompletedSoFar: wave1Result.phasesCompleted,
    };
  }

  // No checkpoint needed -- continue to Wave 2
  return await executeFromWave2(ctx, stateAfterWave1, allRequirementIds);
}

// ---------------------------------------------------------------------------
// Stage dispatcher (for resuming from any stage)
// ---------------------------------------------------------------------------

/**
 * Dispatch to the correct pipeline stage based on current state status.
 * Used when resuming from wave_2, wave_3, uat, or deploying.
 */
async function executeFromStage(
  ctx: PipelineContext,
  state: ForgeState,
): Promise<PipelineResult> {
  switch (state.status) {
    case "wave_2":
      return await executeFromWave2(ctx, state);
    case "wave_3":
      return await executeFromWave3(ctx);
    case "uat":
      return await executeFromUAT(ctx);
    case "deploying":
      return await executeFromDeployment(ctx);
    default:
      return await executeFromWave2(ctx, state);
  }
}

// ---------------------------------------------------------------------------
// Wave 1 execution
// ---------------------------------------------------------------------------

async function executeWave1(
  ctx: PipelineContext,
  waves: number[][],
  phaseMap: Map<number, PipelinePhase>,
  initialState: ForgeState,
): Promise<WaveResult> {
  // Update state: entering Wave 1
  await safeUpdateState(ctx, { status: "wave_1", currentWave: 1 });

  const mockManager = new MockManager(ctx.stateManager);
  const phaseRunnerCtx = buildPhaseRunnerCtx(ctx);

  const phasesCompleted: number[] = [];
  const phasesFailed: number[] = [];
  const allServicesDetected: ServiceDetection[] = [];
  const allSkippedItems: SkippedItem[] = [];

  // Execute each wave group in order
  for (const waveGroup of waves) {
    // For each phase in the wave (sequential in v1)
    for (const phaseNumber of waveGroup) {
      const currentState = ctx.stateManager.load();

      // Skip if already completed
      const phaseKey = String(phaseNumber);
      if (currentState.phases[phaseKey]?.status === "completed") {
        phasesCompleted.push(phaseNumber);
        continue;
      }

      const phase = phaseMap.get(phaseNumber);
      if (!phase) continue;

      // Skip if any dependency phase failed or was not completed
      const depsNotMet = phase.dependsOn.some(
        (dep) => !phasesCompleted.includes(dep),
      );
      if (depsNotMet && phase.dependsOn.length > 0) {
        phasesFailed.push(phaseNumber);
        continue;
      }

      // Detect external services
      const detectedServices = mockManager.detectExternalServices(
        phase.description,
        phase.number,
      );

      // Build mock instructions
      const mockInstructions =
        mockManager.buildMockInstructions(detectedServices);

      // Execute phase
      const result = await ctx.runPhaseFn(phaseNumber, phaseRunnerCtx, {
        mockInstructions: mockInstructions || undefined,
        requirementIds: phase.requirementIds,
      });

      // Register detected mocks
      for (const svc of detectedServices) {
        await mockManager.registerMock(svc.service, {
          interface: `src/services/${svc.service}.ts`,
          mock: `src/services/${svc.service}.mock.ts`,
          real: `src/services/${svc.service}.real.ts`,
          factory: `src/services/${svc.service}.factory.ts`,
          testFixtures: [],
          envVars: svc.credentialsNeeded,
        });
      }

      // Collect results
      if (result.status === "completed") {
        phasesCompleted.push(phaseNumber);
      } else {
        phasesFailed.push(phaseNumber);

        // Collect skipped items from partial results
        if (result.status === "partial" || result.status === "failed") {
          const gapsRemaining =
            result.status === "failed" ? result.gapsRemaining ?? [] : [];
          for (const gap of gapsRemaining) {
            allSkippedItems.push({
              requirement: gap,
              phase: phaseNumber,
              attempts: [
                {
                  approach: "Wave 1 execution",
                  error:
                    result.status === "failed"
                      ? result.reason
                      : "Phase incomplete",
                },
              ],
            });
          }
        }
      }

      // Accumulate services
      allServicesDetected.push(...detectedServices);

      // Update state with detected services and skipped items
      await safeUpdateState(ctx, {
        servicesNeeded: mergeServices(
          currentState.servicesNeeded,
          detectedServices,
        ),
        skippedItems: [...currentState.skippedItems, ...allSkippedItems.filter(
          (item) =>
            !currentState.skippedItems.some(
              (existing) => existing.requirement === item.requirement,
            ),
        )],
      });
    }
  }

  return {
    wave: 1,
    phasesCompleted,
    phasesFailed,
    servicesDetected: allServicesDetected,
    skippedItems: allSkippedItems,
  };
}

// ---------------------------------------------------------------------------
// Wave 2 execution (mock-to-real swap)
// ---------------------------------------------------------------------------

async function executeFromWave2(
  ctx: PipelineContext,
  state: ForgeState,
  allRequirementIds?: string[],
): Promise<PipelineResult> {
  // =========================================================================
  // Wave 2: Real integrations (PIPE-05, PIPE-06)
  // =========================================================================

  try {
    await safeUpdateState(ctx, { status: "wave_2", currentWave: 2 });

    const mockManager = new MockManager(ctx.stateManager);

    // Swap mocks for real implementations (PIPE-05)
    if (state.servicesNeeded.length > 0) {
      const registry = await mockManager.getMockRegistry();
      const integrationPrompt = buildIntegrationPrompt(
        state.servicesNeeded.map((s) => ({
          service: s.service,
          why: s.why,
          phase: 1,
          signupUrl: s.signupUrl,
          credentialsNeeded: s.credentialsNeeded,
        })),
        state.credentials,
      );
      const swapPrompt = mockManager.buildSwapPrompt(
        registry,
        state.credentials,
      );

      const combinedPrompt = [integrationPrompt, "", swapPrompt].join("\n");

      await runStep(
        "integrate-real-services",
        {
          prompt: combinedPrompt,
          verify: async () => true,
        },
        ctx.stepRunnerContext,
        ctx.costController,
      );
    }


    // Address skipped items (PIPE-06)
    if (state.skippedItems.length > 0) {
      for (const item of state.skippedItems) {
        const guidance = state.humanGuidance[item.requirement] ?? "";
        const prompt = buildSkippedItemPrompt(item, guidance);

        await runStep(
          `fix-skipped-${item.requirement}`,
          {
            prompt,
            verify: async () => true,
          },
          ctx.stepRunnerContext,
          ctx.costController,
        );
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    await safeUpdateState(ctx, { status: "failed" });
    return {
      status: "failed",
      wave: 2,
      reason,
      phasesCompletedSoFar: getCompletedPhaseNumbers(ctx.stateManager.load()),
      phasesFailed: getFailedPhaseNumbers(ctx.stateManager.load()),
    };
  }

  // Continue to Wave 3
  return await executeFromWave3(ctx, allRequirementIds);
}

// ---------------------------------------------------------------------------
// Wave 3: Spec compliance
// ---------------------------------------------------------------------------

async function executeFromWave3(
  ctx: PipelineContext,
  allRequirementIds?: string[],
): Promise<PipelineResult> {
  // Reconstruct requirement IDs if not provided
  let reqIds = allRequirementIds;
  if (!reqIds) {
    reqIds = await reconstructRequirementIds(ctx);
  }

  let complianceResult: SpecComplianceResult;
  try {
    await safeUpdateState(ctx, { status: "wave_3", currentWave: 3 });

    complianceResult = await runSpecComplianceLoop(reqIds, ctx);

    if (!complianceResult.converged) {
      if (didMakeProgress(complianceResult.gapHistory)) {
        // Made progress but didn't fully converge — continue to UAT with warning
        console.warn(
          `[forge] Warning: Spec compliance did not fully converge after ${complianceResult.roundsCompleted} rounds. ` +
          `Remaining gaps: ${complianceResult.remainingGaps.join(", ")}. Continuing to UAT.`,
        );
      } else {
        // Genuinely stuck — gaps not decreasing
        await safeUpdateState(ctx, { status: "failed" });
        return {
          status: "stuck",
          wave: 3,
          reason: `Spec compliance did not converge after ${complianceResult.roundsCompleted} rounds`,
          nonConverging: true,
          gapHistory: complianceResult.gapHistory,
        };
      }
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    await safeUpdateState(ctx, { status: "failed" });
    return {
      status: "failed",
      wave: 3,
      reason,
      phasesCompletedSoFar: getCompletedPhaseNumbers(ctx.stateManager.load()),
      phasesFailed: getFailedPhaseNumbers(ctx.stateManager.load()),
    };
  }

  // Continue to UAT
  return await executeFromUAT(ctx, complianceResult);
}

// ---------------------------------------------------------------------------
// UAT gate
// ---------------------------------------------------------------------------

async function executeFromUAT(
  ctx: PipelineContext,
  complianceResult?: SpecComplianceResult,
): Promise<PipelineResult> {
  // If no compliance result (resuming directly into UAT), reconstruct from state
  if (!complianceResult) {
    const stateNow = ctx.stateManager.load();
    complianceResult = {
      converged: stateNow.remainingGaps.length === 0,
      roundsCompleted: stateNow.specCompliance.roundsCompleted,
      gapHistory: stateNow.specCompliance.gapHistory,
      remainingGaps: stateNow.remainingGaps,
    };
  }

  try {
    await safeUpdateState(ctx, { status: "uat" });

    // Build UATContext from PipelineContext
    const uatCtx: UATContext = {
      config: ctx.config,
      stateManager: ctx.stateManager,
      stepRunnerContext: ctx.stepRunnerContext,
      costController: ctx.costController,
      fs: ctx.fs as UATContext["fs"],
      execFn: ctx.execFn,
      runStepFn: ctx.runStepFn,
    };

    const uatResult: UATResult = await runUAT(uatCtx);

    // Update state with UAT results
    await safeUpdateState(ctx, {
      uatResults: {
        status: uatResult.status === "stuck" ? "failed" : uatResult.status,
        workflowsTested: uatResult.workflowsTested,
        workflowsPassed: uatResult.workflowsPassed,
        workflowsFailed: uatResult.workflowsFailed,
      },
    });

    if (uatResult.status === "passed") {
      // Continue to deployment
    } else if (uatResult.status === "failed") {
      await safeUpdateState(ctx, { status: "failed" });
      return {
        status: "failed",
        wave: 4,
        reason: "UAT failed",
        phasesCompletedSoFar: getCompletedPhaseNumbers(
          ctx.stateManager.load(),
        ),
        phasesFailed: [],
      };
    } else {
      // status === "stuck"
      await safeUpdateState(ctx, { status: "failed" });
      return {
        status: "stuck",
        wave: 4,
        reason: "UAT not converging",
        nonConverging: true,
        gapHistory: [],
      };
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    await safeUpdateState(ctx, { status: "failed" });
    return {
      status: "failed",
      wave: 4,
      reason,
      phasesCompletedSoFar: getCompletedPhaseNumbers(ctx.stateManager.load()),
      phasesFailed: getFailedPhaseNumbers(ctx.stateManager.load()),
    };
  }

  // Continue to deployment
  return await executeFromDeployment(ctx, complianceResult);
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

async function executeFromDeployment(
  ctx: PipelineContext,
  complianceResult?: SpecComplianceResult,
): Promise<PipelineResult> {
  // If no compliance result (resuming directly into deployment), reconstruct from state
  if (!complianceResult) {
    const stateNow = ctx.stateManager.load();
    complianceResult = {
      converged: stateNow.remainingGaps.length === 0,
      roundsCompleted: stateNow.specCompliance.roundsCompleted,
      gapHistory: stateNow.specCompliance.gapHistory,
      remainingGaps: stateNow.remainingGaps,
    };
  }

  let deploymentUrl: string | undefined;

  try {
    await safeUpdateState(ctx, { status: "deploying" });

    const deployCtx: DeploymentContext = {
      config: ctx.config,
      stateManager: ctx.stateManager,
      stepRunnerContext: ctx.stepRunnerContext,
      costController: ctx.costController,
      execFn: ctx.execFn,
      runStepFn: ctx.runStepFn,
      fetchFn: ctx.fetchFn,
    };

    const deployResult = await runDeployment(deployCtx);

    if (deployResult.status === "deployed") {
      deploymentUrl = deployResult.url;
    } else if (deployResult.status === "failed") {
      // Deployment failure is not fatal — app is built and tested, just not deployed
      // Log but continue to milestone completion
      console.warn(
        `[forge] Warning: Deployment failed after ${deployResult.attempts.length} attempts: ${deployResult.reason}`,
      );
    }
    // status === "skipped" — not a web app, continue normally
  } catch (error) {
    // Deployment errors are non-fatal — the software is built and tested
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[forge] Warning: Deployment error: ${reason}`);
  }

  // =========================================================================
  // Milestone completion (PIPE-10)
  // =========================================================================

  try {
    // Audit milestone
    const auditResult = await runStep(
      "audit-milestone",
      {
        prompt: [
          "Run milestone audit to verify all requirements are met.",
          "",
          "Check:",
          "1. All requirements from REQUIREMENTS.md are implemented",
          "2. All tests pass",
          "3. Code quality checks pass (lint, typecheck)",
          "4. Documentation is up to date",
        ].join("\n"),
        verify: async () => true,
      },
      ctx.stepRunnerContext,
      ctx.costController,
    );

    // If audit finds gaps, run targeted fixes
    if (auditResult.status === "failed") {
      await runStep(
        "fix-milestone-gaps",
        {
          prompt: [
            "Fix remaining gaps found by milestone audit.",
            "",
            `Audit result: ${auditResult.error}`,
          ].join("\n"),
          verify: async () => true,
        },
        ctx.stepRunnerContext,
        ctx.costController,
      );
    }

    // Complete milestone
    await runStep(
      "complete-milestone",
      {
        prompt: [
          "Finalize the milestone.",
          "",
          "Tasks:",
          "1. Generate final milestone report",
          "2. Update all documentation",
          "3. Ensure clean build and all tests pass",
        ].join("\n"),
        verify: async () => true,
      },
      ctx.stepRunnerContext,
      ctx.costController,
    );

    await safeUpdateState(ctx, { status: "completed" });

    return {
      status: "completed",
      wavesCompleted: 4,
      phasesCompleted: getCompletedPhaseNumbers(ctx.stateManager.load()),
      totalCostUsd: ctx.stateManager.load().totalBudgetUsed,
      specCompliance: complianceResult,
      deploymentUrl,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    await safeUpdateState(ctx, { status: "failed" });
    return {
      status: "failed",
      wave: 4,
      reason,
      phasesCompletedSoFar: getCompletedPhaseNumbers(ctx.stateManager.load()),
      phasesFailed: getFailedPhaseNumbers(ctx.stateManager.load()),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if the compliance loop made progress even though it didn't fully converge.
 *
 * Progress means the final gap count is strictly less than the first round's gap count.
 * gapHistory[0] is the baseline (total requirements), gapHistory[1] is round 1 result, etc.
 *
 * @param gapHistory - Array of gap counts per round
 * @returns true if gaps decreased from round 1 to the final round
 */
export function didMakeProgress(gapHistory: number[]): boolean {
  if (gapHistory.length < 3) return false; // Need baseline + at least 2 rounds
  const firstRoundGaps = gapHistory[1];
  const lastRoundGaps = gapHistory[gapHistory.length - 1];
  return lastRoundGaps < firstRoundGaps;
}

/**
 * Reconstruct requirement IDs from the roadmap file.
 */
async function reconstructRequirementIds(ctx: PipelineContext): Promise<string[]> {
  try {
    const fs = ctx.fs ?? (await import("node:fs"));
    const roadmapContent = fs.readFileSync(
      ".planning/ROADMAP.md",
      "utf-8",
    ) as string;
    const { phases } = getExecutionWaves(roadmapContent);
    return collectAllRequirementIds(phases);
  } catch {
    return [];
  }
}

/**
 * Safely update state fields without throwing.
 */
async function safeUpdateState(
  ctx: PipelineContext,
  fields: Partial<ForgeState>,
): Promise<void> {
  try {
    await ctx.stateManager.update((state) => ({
      ...state,
      ...fields,
    }));
  } catch (err) {
    console.warn("[forge] Warning: state update failed:", err);
  }
}

/**
 * Get phase numbers with status "completed".
 */
function getCompletedPhaseNumbers(state: ForgeState): number[] {
  return Object.entries(state.phases)
    .filter(([, p]) => p.status === "completed")
    .map(([key]) => parseInt(key, 10))
    .sort((a, b) => a - b);
}

/**
 * Get phase numbers with status "failed".
 */
function getFailedPhaseNumbers(state: ForgeState): number[] {
  return Object.entries(state.phases)
    .filter(([, p]) => p.status === "failed")
    .map(([key]) => parseInt(key, 10))
    .sort((a, b) => a - b);
}

/**
 * Collect all requirement IDs across all phases.
 */
function collectAllRequirementIds(phases: PipelinePhase[]): string[] {
  const ids = new Set<string>();
  for (const phase of phases) {
    for (const id of phase.requirementIds) {
      ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Merge new service detections into existing services array.
 * Deduplicates by service name.
 */
function mergeServices(
  existing: ForgeState["servicesNeeded"],
  detected: ServiceDetection[],
): ForgeState["servicesNeeded"] {
  const seen = new Set(existing.map((s) => s.service));
  const merged = [...existing];

  for (const svc of detected) {
    if (!seen.has(svc.service)) {
      seen.add(svc.service);
      merged.push({
        service: svc.service,
        why: svc.why,
        signupUrl: svc.signupUrl,
        credentialsNeeded: svc.credentialsNeeded,
        mockedIn: [`phase-${svc.phase}`],
      });
    }
  }

  return merged;
}
