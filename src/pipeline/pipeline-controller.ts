/**
 * Pipeline Controller FSM
 *
 * The main orchestrator that composes all pipeline modules into the wave model:
 * Wave 1 (build with mocks) -> Human Checkpoint -> Wave 2 (real integrations) ->
 * Wave 3+ (spec compliance) -> UAT gate -> Milestone completion.
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

import type {
  PipelineContext,
  PipelineResult,
  PipelinePhase,
  ServiceDetection,
  SkippedItem,
  WaveResult,
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
 * initializing -> wave_1 -> human_checkpoint -> wave_2 -> wave_3 -> uat -> completed
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
    };
  }

  if (state.status === "failed") {
    return {
      status: "failed",
      wave: state.currentWave,
      reason: "Pipeline previously failed",
      phasesCompletedSoFar: getCompletedPhaseNumbers(state),
      phasesFailed: getFailedPhaseNumbers(state),
    };
  }

  // If resuming from human_checkpoint, skip directly to Wave 2
  if (state.status === "human_checkpoint") {
    return await executeFromWave2(ctx, state);
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
// Wave 2+ execution (resume entry point)
// ---------------------------------------------------------------------------

async function executeFromWave2(
  ctx: PipelineContext,
  state: ForgeState,
  allRequirementIds?: string[],
): Promise<PipelineResult> {
  // If no requirement IDs were passed, reconstruct from roadmap
  let reqIds = allRequirementIds;
  if (!reqIds) {
    try {
      const fs = ctx.fs ?? (await import("node:fs"));
      const roadmapContent = fs.readFileSync(
        ".planning/ROADMAP.md",
        "utf-8",
      ) as string;
      const { phases } = getExecutionWaves(roadmapContent);
      reqIds = collectAllRequirementIds(phases);
    } catch {
      reqIds = [];
    }
  }

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

  // =========================================================================
  // Wave 3+: Spec compliance (delegates to runSpecComplianceLoop)
  // =========================================================================

  let complianceResult;
  try {
    await safeUpdateState(ctx, { status: "wave_3", currentWave: 3 });

    complianceResult = await runSpecComplianceLoop(reqIds, ctx);

    if (!complianceResult.converged) {
      await safeUpdateState(ctx, { status: "failed" });
      return {
        status: "stuck",
        wave: 3,
        reason: `Spec compliance did not converge after ${complianceResult.roundsCompleted} rounds`,
        nonConverging: true,
        gapHistory: complianceResult.gapHistory,
      };
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

  // =========================================================================
  // UAT gate (PIPE-09)
  // =========================================================================

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
      // Continue to milestone completion
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
  } catch {
    // State update is non-critical -- continue even if it fails
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
