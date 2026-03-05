/**
 * Spec Compliance Loop Tests
 *
 * Tests for convergence checking, requirement verification,
 * and the full compliance loop with mocked dependencies.
 *
 * Requirements: PIPE-07, PIPE-08
 */

import { describe, it, expect, vi } from "vitest";
import {
  checkConvergence,
  verifyRequirement,
  runSpecComplianceLoop,
} from "./spec-compliance.js";
import type { PipelineContext } from "./types.js";
import type { ForgeState } from "../state/schema.js";
import type { ForgeConfig } from "../config/schema.js";
import type { StepRunnerContext, StepResult } from "../step-runner/types.js";

/**
 * Create a mock ForgeState for testing.
 */
function makeState(overrides: Partial<ForgeState> = {}): ForgeState {
  return {
    projectDir: "/test/project",
    startedAt: "2026-01-01T00:00:00Z",
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "wave_1",
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {},
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 0,
      verified: 0,
      gapHistory: [],
      roundsCompleted: 0,
    },
    remainingGaps: [],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 0,
    ...overrides,
  };
}

/**
 * Create a minimal mock config.
 */
function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    model: "claude-opus-4-6",
    maxBudgetTotal: 200,
    maxBudgetPerStep: 15,
    maxRetries: 3,
    maxComplianceRounds: 5,
    maxTurnsPerStep: 200,
    testing: {
      stack: "node",
      unitCommand: "npm test -- --json",
      integrationCommand: "npm run test:integration -- --json",
      scenarioCommand: "npm run test:e2e",
      dockerComposeFile: "docker-compose.test.yml",
    },
    verification: {
      files: true,
      tests: true,
      typecheck: true,
      lint: true,
      dockerSmoke: false,
      testCoverageCheck: true,
      observabilityCheck: false,
      deployment: false,
    },
    notion: {
      parentPageId: "",
      docPages: {
        architecture: "",
        dataFlow: "",
        apiReference: "",
        componentIndex: "",
        adrs: "",
        deployment: "",
        devWorkflow: "",
        phaseReports: "",
      },
    },
    parallelism: {
      maxConcurrentPhases: 3,
      enableSubagents: true,
      backgroundDocs: true,
    },
    deployment: {
      target: "vercel",
      environments: ["development", "staging", "production"],
    },
    notifications: {
      onHumanNeeded: "stdout",
      onPhaseComplete: "stdout",
      onFailure: "stdout",
    },
    ...overrides,
  };
}

/**
 * Create a mock PipelineContext with controllable runStep behavior.
 */
function makeMockContext(options: {
  verifyResults?: Record<string, { passed: boolean; gapDescription: string }>;
  maxComplianceRounds?: number;
}): {
  ctx: PipelineContext;
  stepCalls: Array<{ name: string; prompt: string }>;
  stateUpdates: Array<(state: ForgeState) => ForgeState>;
} {
  const stepCalls: Array<{ name: string; prompt: string }> = [];
  const stateUpdates: Array<(state: ForgeState) => ForgeState> = [];
  let currentState = makeState();

  const verifyResults = options.verifyResults ?? {};

  // Round tracking for dynamic verify results
  let verifyCallCount = 0;

  const mockExecuteQuery = async (opts: any): Promise<any> => {
    // Determine which requirement is being verified by examining prompt
    const prompt = opts.prompt as string;

    // Check if this is a verify step
    for (const [reqId, result] of Object.entries(verifyResults)) {
      if (prompt.includes(reqId)) {
        return {
          ok: true,
          result: JSON.stringify(result),
          structuredOutput: result,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock-session",
        };
      }
    }

    // Default: return passed for fix steps or unknown verifications
    return {
      ok: true,
      result: "Fixed",
      structuredOutput: { passed: true, gapDescription: "" },
      cost: { totalCostUsd: 0.01 },
      sessionId: "mock-session",
    };
  };

  const stepRunnerContext: StepRunnerContext = {
    config: makeConfig({ maxComplianceRounds: options.maxComplianceRounds ?? 5 }),
    stateManager: {
      load: () => currentState,
      update: async (updater: (state: ForgeState) => ForgeState) => {
        stateUpdates.push(updater);
        currentState = updater(currentState);
        return currentState;
      },
    } as any,
    executeQueryFn: mockExecuteQuery,
  };

  const costController = {
    checkBudget: () => {},
    recordStepCost: () => {},
  } as any;

  const stateManager = {
    load: () => currentState,
    update: async (updater: (state: ForgeState) => ForgeState) => {
      stateUpdates.push(updater);
      currentState = updater(currentState);
      return currentState;
    },
  } as any;

  const ctx: PipelineContext = {
    config: makeConfig({ maxComplianceRounds: options.maxComplianceRounds ?? 5 }),
    stateManager,
    stepRunnerContext,
    costController,
    runPhaseFn: async () => ({
      status: "completed" as const,
      phaseNumber: 1,
      requirementsCompleted: [],
      testResults: { passed: 0, failed: 0, total: 0 },
      verificationReport: { checks: [], allPassed: true },
      costUsd: 0,
    }),
  };

  return { ctx, stepCalls, stateUpdates };
}

// ============================================================================
// checkConvergence tests
// ============================================================================

describe("checkConvergence", () => {
  it("TestSpecCompliance_CheckConvergence_Improving", () => {
    const result = checkConvergence([10, 5, 3]);
    expect(result.converging).toBe(true);
    expect(result.reason).toContain("3");
  });

  it("TestSpecCompliance_CheckConvergence_Stuck", () => {
    const result = checkConvergence([10, 5, 5]);
    expect(result.converging).toBe(false);
    expect(result.reason).toContain("stuck");
  });

  it("TestSpecCompliance_CheckConvergence_Worsening", () => {
    const result = checkConvergence([10, 5, 7]);
    expect(result.converging).toBe(false);
    expect(result.reason).toContain("increased");
  });

  it("TestSpecCompliance_CheckConvergence_SingleRound", () => {
    // [baseline=10, round1=3] -- first round always converging
    const result = checkConvergence([10, 3]);
    expect(result.converging).toBe(true);
    expect(result.reason).toContain("First round");
  });

  it("TestSpecCompliance_CheckConvergence_AllFixed", () => {
    const result = checkConvergence([10, 0]);
    expect(result.converging).toBe(true);
    expect(result.reason).toContain("resolved");
  });

  it("TestSpecCompliance_CheckConvergence_NotEnoughData", () => {
    const result = checkConvergence([10]);
    expect(result.converging).toBe(true);
    expect(result.reason).toContain("Not enough data");
  });

  it("TestSpecCompliance_CheckConvergence_MultiRoundAllFixed", () => {
    const result = checkConvergence([10, 5, 0]);
    expect(result.converging).toBe(true);
    expect(result.reason).toContain("resolved");
  });
});

// ============================================================================
// verifyRequirement tests
// ============================================================================

describe("verifyRequirement", () => {
  it("TestSpecCompliance_VerifyRequirement_Passes", async () => {
    const { ctx } = makeMockContext({
      verifyResults: {
        "AUTH-01": { passed: true, gapDescription: "" },
      },
    });

    const result = await verifyRequirement("AUTH-01", ctx);

    expect(result.passed).toBe(true);
    expect(result.gapDescription).toBe("");
  });

  it("TestSpecCompliance_VerifyRequirement_Fails", async () => {
    const { ctx } = makeMockContext({
      verifyResults: {
        "AUTH-02": {
          passed: false,
          gapDescription: "Missing password hashing",
        },
      },
    });

    const result = await verifyRequirement("AUTH-02", ctx);

    expect(result.passed).toBe(false);
    expect(result.gapDescription).toBe("Missing password hashing");
  });
});

// ============================================================================
// runSpecComplianceLoop tests
// ============================================================================

describe("runSpecComplianceLoop", () => {
  it("TestSpecCompliance_Loop_AllPass_Round1", async () => {
    const { ctx } = makeMockContext({
      verifyResults: {
        "REQ-01": { passed: true, gapDescription: "" },
        "REQ-02": { passed: true, gapDescription: "" },
        "REQ-03": { passed: true, gapDescription: "" },
      },
    });

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(true);
    expect(result.roundsCompleted).toBe(1);
    expect(result.gapHistory).toEqual([3, 0]);
    expect(result.remainingGaps).toEqual([]);
  });

  it("TestSpecCompliance_Loop_ConvergesRound2", async () => {
    // Round 1: REQ-01 fails, REQ-02 passes
    // After fix: REQ-01 passes (dynamic behavior via call count)
    let round1Done = false;

    const { ctx } = makeMockContext({});

    // Override executeQueryFn to simulate dynamic behavior
    let verifyCallCount = 0;
    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      // Track verify calls
      if (prompt.includes("Verify whether requirement")) {
        verifyCallCount++;

        // REQ-02 always passes
        if (prompt.includes("REQ-02")) {
          return {
            ok: true,
            result: "",
            structuredOutput: { passed: true, gapDescription: "" },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        // REQ-01: fails first time, passes after fix
        if (prompt.includes("REQ-01")) {
          if (!round1Done) {
            return {
              ok: true,
              result: "",
              structuredOutput: {
                passed: false,
                gapDescription: "Missing validation",
              },
              cost: { totalCostUsd: 0.01 },
              sessionId: "mock",
            };
          }
          return {
            ok: true,
            result: "",
            structuredOutput: { passed: true, gapDescription: "" },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }
      }

      // Fix step
      if (prompt.includes("Fix spec compliance gap")) {
        round1Done = true;
      }

      return {
        ok: true,
        result: "done",
        structuredOutput: { passed: true, gapDescription: "" },
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock",
      };
    };

    const result = await runSpecComplianceLoop(["REQ-01", "REQ-02"], ctx);

    expect(result.converged).toBe(true);
    expect(result.roundsCompleted).toBe(2);
    expect(result.gapHistory).toEqual([2, 1, 0]);
    expect(result.remainingGaps).toEqual([]);
  });

  it("TestSpecCompliance_Loop_NotConverging", async () => {
    // Gaps stay the same across rounds: [3, 2, 2] -> stops at round 2
    let fixAttempts = 0;

    const { ctx } = makeMockContext({
      maxComplianceRounds: 5,
    });

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      if (prompt.includes("Verify whether requirement")) {
        // REQ-01 always fails
        if (prompt.includes("REQ-01")) {
          return {
            ok: true,
            result: "",
            structuredOutput: {
              passed: false,
              gapDescription: "Still broken",
            },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }
        // REQ-02: fails round 1, passes after
        if (prompt.includes("REQ-02")) {
          if (fixAttempts === 0) {
            return {
              ok: true,
              result: "",
              structuredOutput: {
                passed: false,
                gapDescription: "Needs fix",
              },
              cost: { totalCostUsd: 0.01 },
              sessionId: "mock",
            };
          }
          return {
            ok: true,
            result: "",
            structuredOutput: { passed: true, gapDescription: "" },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }
        // REQ-03 always passes
        return {
          ok: true,
          result: "",
          structuredOutput: { passed: true, gapDescription: "" },
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Fix step
      if (prompt.includes("Fix spec compliance gap")) {
        fixAttempts++;
      }

      return {
        ok: true,
        result: "done",
        structuredOutput: null,
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock",
      };
    };

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(false);
    // Round 1: 2 gaps (REQ-01, REQ-02) -> fix -> Round 2: 1 gap (REQ-01) -> fix -> Round 3: 1 gap (REQ-01) -> stopped (1 === 1)
    expect(result.gapHistory[0]).toBe(3); // baseline
    expect(result.gapHistory[1]).toBe(2); // round 1: REQ-01 + REQ-02
    expect(result.gapHistory[2]).toBe(1); // round 2: REQ-01 only
    // Round 3 shows 1 gap again -- not converging (1 === 1)
    expect(result.remainingGaps).toContain("REQ-01");
  });

  it("TestSpecCompliance_Loop_MaxRoundsExhausted", async () => {
    // Set max rounds to 2, gaps keep decreasing but don't reach 0
    const { ctx } = makeMockContext({
      maxComplianceRounds: 2,
    });

    let round = 0;

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      if (prompt.includes("Verify whether requirement")) {
        // REQ-01: always fails (stubborn gap)
        if (prompt.includes("REQ-01")) {
          return {
            ok: true,
            result: "",
            structuredOutput: {
              passed: false,
              gapDescription: "Persistent issue",
            },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }
        // REQ-02: fails round 1, passes after
        if (prompt.includes("REQ-02")) {
          if (round < 1) {
            return {
              ok: true,
              result: "",
              structuredOutput: {
                passed: false,
                gapDescription: "Fixable",
              },
              cost: { totalCostUsd: 0.01 },
              sessionId: "mock",
            };
          }
          return {
            ok: true,
            result: "",
            structuredOutput: { passed: true, gapDescription: "" },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }
        return {
          ok: true,
          result: "",
          structuredOutput: { passed: true, gapDescription: "" },
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Fix step increments round
      if (prompt.includes("Fix spec compliance gap")) {
        round++;
      }

      return {
        ok: true,
        result: "done",
        structuredOutput: null,
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock",
      };
    };

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(false);
    expect(result.roundsCompleted).toBe(2);
    expect(result.gapHistory[0]).toBe(3); // baseline
    // Each round should show decreasing gaps
    expect(result.remainingGaps).toContain("REQ-01");
  });

  it("TestSpecCompliance_Loop_UpdatesState", async () => {
    const { ctx, stateUpdates } = makeMockContext({
      verifyResults: {
        "REQ-01": { passed: true, gapDescription: "" },
      },
    });

    await runSpecComplianceLoop(["REQ-01"], ctx);

    // Should have state updates: wave_3 status + round results
    expect(stateUpdates.length).toBeGreaterThan(0);

    // Check that the first update sets wave_3 status
    const initialState = makeState();
    const firstUpdate = stateUpdates[0](initialState);
    expect(firstUpdate.status).toBe("wave_3");
  });
});
