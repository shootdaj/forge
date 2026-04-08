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
  readRequirementsDoc,
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
 *
 * The mock now handles both batch and individual verification prompts.
 * Batch prompts contain all requirement IDs; the mock builds a JSON
 * array response based on the verifyResults map.
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

  const mockExecuteQuery = async (opts: any): Promise<any> => {
    const prompt = opts.prompt as string;

    // Handle batch verification prompt
    if (prompt.includes("Verify whether each of the following requirements")) {
      const verdicts = Object.entries(verifyResults).map(([id, result]) => ({
        id,
        ...result,
      }));
      // Also include any requirement IDs in the prompt not in verifyResults as passed
      const allReqIds = prompt.match(/- ([\w-]+)/g)?.map((m: string) => m.slice(2)) ?? [];
      for (const id of allReqIds) {
        if (!verifyResults[id]) {
          verdicts.push({ id, passed: true, gapDescription: "" });
        }
      }
      return {
        ok: true,
        result: "```json\n" + JSON.stringify(verdicts) + "\n```",
        structuredOutput: null,
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock-session",
      };
    }

    // Handle individual verification prompt (fallback path)
    if (prompt.includes("Verify whether requirement")) {
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
    // Incremental fix: REQ-01 fixed within round 1, verified, no regressions
    // Result: converges in round 1 with gapHistory [2, 0]
    let round1FixApplied = false;

    const { ctx } = makeMockContext({});

    // Add execFn for git operations
    (ctx as any).execFn = (cmd: string) => {
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("git add")) return "";
      return "";
    };

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      // Handle batch verification (at round start)
      if (prompt.includes("Verify whether each of the following requirements")) {
        const verdicts = [
          { id: "REQ-01", passed: round1FixApplied, gapDescription: round1FixApplied ? "" : "Missing validation" },
          { id: "REQ-02", passed: true, gapDescription: "" },
        ];
        return {
          ok: true,
          result: "```json\n" + JSON.stringify(verdicts) + "\n```",
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Handle individual verification (after fix)
      if (prompt.includes("Verify whether requirement")) {
        if (prompt.includes("REQ-02")) {
          return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
        if (prompt.includes("REQ-01")) {
          return { ok: true, result: "", structuredOutput: { passed: round1FixApplied, gapDescription: round1FixApplied ? "" : "Missing validation" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
      }

      // Fix step — marks the fix as applied
      if (prompt.includes("INCREMENTAL FIX") || prompt.includes("Fix")) {
        round1FixApplied = true;
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    const result = await runSpecComplianceLoop(["REQ-01", "REQ-02"], ctx);

    expect(result.converged).toBe(true);
    // Incremental loop fixes the gap within round 1, so converges in 1 round
    expect(result.roundsCompleted).toBe(1);
    expect(result.gapHistory).toEqual([2, 0]);
    expect(result.remainingGaps).toEqual([]);
  });

  it("TestSpecCompliance_Loop_NotConverging", async () => {
    // Incremental loop: REQ-01 never fixes, REQ-02 fixes in round 1
    // Round 1: batch shows 2 gaps (REQ-01, REQ-02). Fix REQ-01 fails verify -> deferred.
    //   Fix REQ-02 succeeds. Gap count goes to 1.
    // Round 2: batch shows 1 gap (REQ-01). Fix REQ-01 fails verify -> deferred.
    //   Gap count stays at 1. (1 === 1 -> not converging)
    let req02Fixed = false;

    const { ctx } = makeMockContext({
      maxComplianceRounds: 5,
    });

    // Add execFn for git operations
    (ctx as any).execFn = (cmd: string) => {
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("reset --hard")) return "";
      if (cmd.includes("git add")) return "";
      return "";
    };

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      // Handle batch verification (at round start)
      if (prompt.includes("Verify whether each of the following requirements")) {
        const verdicts = [
          { id: "REQ-01", passed: false, gapDescription: "Still broken" },
          { id: "REQ-02", passed: req02Fixed, gapDescription: req02Fixed ? "" : "Needs fix" },
          { id: "REQ-03", passed: true, gapDescription: "" },
        ];
        return {
          ok: true,
          result: "```json\n" + JSON.stringify(verdicts) + "\n```",
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Handle individual verification (after fix)
      if (prompt.includes("Verify whether requirement")) {
        if (prompt.includes("REQ-01")) return { ok: true, result: "", structuredOutput: { passed: false, gapDescription: "Still broken" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        if (prompt.includes("REQ-02")) return { ok: true, result: "", structuredOutput: { passed: req02Fixed, gapDescription: req02Fixed ? "" : "Needs fix" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      }

      // Fix step — REQ-02 gets fixed, REQ-01 never does
      if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-02")) {
        req02Fixed = true;
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(false);
    expect(result.gapHistory[0]).toBe(3); // baseline
    // Round 1: REQ-01 deferred (fix fails verify), REQ-02 fixed -> 1 gap remains
    expect(result.gapHistory[1]).toBe(1);
    // Round 2: REQ-01 deferred again -> 1 gap remains (1 === 1 -> not converging)
    expect(result.gapHistory[2]).toBe(1);
    expect(result.remainingGaps).toContain("REQ-01");
  });

  it("TestSpecCompliance_Loop_MaxRoundsExhausted", async () => {
    // Set max rounds to 2, REQ-01 never fixes, REQ-02 fixes in round 1
    const { ctx } = makeMockContext({
      maxComplianceRounds: 2,
    });

    // Add execFn for git operations
    (ctx as any).execFn = (cmd: string) => {
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("reset --hard")) return "";
      if (cmd.includes("git add")) return "";
      return "";
    };

    let req02Fixed = false;

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      // Handle batch verification
      if (prompt.includes("Verify whether each of the following requirements")) {
        const verdicts = [
          { id: "REQ-01", passed: false, gapDescription: "Persistent issue" },
          { id: "REQ-02", passed: req02Fixed, gapDescription: req02Fixed ? "" : "Fixable" },
          { id: "REQ-03", passed: true, gapDescription: "" },
        ];
        return {
          ok: true,
          result: "```json\n" + JSON.stringify(verdicts) + "\n```",
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Handle individual verification (after fix)
      if (prompt.includes("Verify whether requirement")) {
        if (prompt.includes("REQ-01")) return { ok: true, result: "", structuredOutput: { passed: false, gapDescription: "Persistent issue" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        if (prompt.includes("REQ-02")) return { ok: true, result: "", structuredOutput: { passed: req02Fixed, gapDescription: req02Fixed ? "" : "Fixable" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      }

      // Fix step — REQ-02 gets fixed, REQ-01 never does
      if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-02")) {
        req02Fixed = true;
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(false);
    // Max rounds is 2, but not converging detected in round 2 (1 === 1)
    expect(result.gapHistory[0]).toBe(3); // baseline
    // Round 1: REQ-01 deferred, REQ-02 fixed -> 1 gap
    expect(result.gapHistory[1]).toBe(1);
    expect(result.remainingGaps).toContain("REQ-01");
  });

  it("TestSpecCompliance_Loop_IncludesRequirementsDocInVerification", async () => {
    // Verify that when REQUIREMENTS.md is readable, its content
    // is included in the verification prompt
    const capturedPrompts: string[] = [];
    const { ctx } = makeMockContext({
      verifyResults: {
        "REQ-01": { passed: true, gapDescription: "" },
      },
    });

    // Override to capture prompts
    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;
      capturedPrompts.push(prompt);

      if (prompt.includes("Verify whether each of the following requirements")) {
        return {
          ok: true,
          result: '```json\n[{"id": "REQ-01", "passed": true, "gapDescription": ""}]\n```',
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }
      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    // Inject a filesystem that returns a mock REQUIREMENTS.md
    (ctx as any).fs = {
      readFileSync: (p: string) => {
        if (p === "REQUIREMENTS.md") return "## R1: User Auth\nUsers can log in";
        throw new Error("Not found");
      },
      existsSync: () => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };

    await runSpecComplianceLoop(["REQ-01"], ctx);

    // The verification prompt should include the requirements content
    const verifyPrompt = capturedPrompts.find((p) =>
      p.includes("Verify whether each of the following requirements"),
    );
    expect(verifyPrompt).toBeDefined();
    expect(verifyPrompt).toContain("User Auth");
    expect(verifyPrompt).toContain("Full Requirements Document");
  });

  it("TestSpecCompliance_Loop_RegressionCausesRevert", async () => {
    // Incremental loop: Fix REQ-01 causes regression on REQ-02, should revert
    const gitCommands: string[] = [];
    const { ctx } = makeMockContext({ maxComplianceRounds: 5 });

    // Add execFn that records git commands
    (ctx as any).execFn = (cmd: string) => {
      gitCommands.push(cmd);
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("reset --hard")) return "";
      if (cmd.includes("git add")) return "";
      return "";
    };

    let fixApplied = false;

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;

      // Batch verification at round start: both always fail
      if (prompt.includes("Verify whether each of the following requirements")) {
        return {
          ok: true,
          result: '```json\n[{"id":"REQ-01","passed":false,"gapDescription":"Broken"},{"id":"REQ-02","passed":' + (!fixApplied) + ',"gapDescription":"' + (fixApplied ? "Regressed" : "") + '"}]\n```',
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Individual verify after fix: REQ-01 passes but REQ-02 regresses
      if (prompt.includes("Verify whether requirement")) {
        if (prompt.includes("REQ-01")) {
          return { ok: true, result: "", structuredOutput: { passed: fixApplied, gapDescription: fixApplied ? "" : "Broken" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
        if (prompt.includes("REQ-02")) {
          // After REQ-01 fix is applied, REQ-02 regresses
          return { ok: true, result: "", structuredOutput: { passed: !fixApplied, gapDescription: fixApplied ? "Regressed from REQ-01 fix" : "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
      }

      // Fix step for REQ-01
      if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-01")) {
        fixApplied = true;
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    const result = await runSpecComplianceLoop(["REQ-01", "REQ-02"], ctx);

    // Should have attempted git reset --hard (revert)
    const revertCmds = gitCommands.filter((c) => c.includes("reset --hard"));
    expect(revertCmds.length).toBeGreaterThan(0);
    // Should still be non-converging since fix always causes regression
    expect(result.converged).toBe(false);
    expect(result.remainingGaps).toContain("REQ-01");
  });

  it("TestSpecCompliance_Loop_GapFixIncludesRequirementsDoc", async () => {
    // Verify that incremental gap fix prompts include the requirements document
    const capturedPrompts: string[] = [];
    let fixApplied = false;
    const { ctx } = makeMockContext({ maxComplianceRounds: 2 });

    // Add execFn for git operations
    (ctx as any).execFn = (cmd: string) => {
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("git add")) return "";
      return "";
    };

    (ctx.stepRunnerContext as any).executeQueryFn = async (opts: any) => {
      const prompt = opts.prompt as string;
      capturedPrompts.push(prompt);

      if (prompt.includes("Verify whether each of the following requirements")) {
        return {
          ok: true,
          result: '```json\n[{"id":"REQ-01","passed":' + fixApplied + ',"gapDescription":"' + (fixApplied ? "" : "Missing feature") + '"}]\n```',
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      // Individual verify after fix
      if (prompt.includes("Verify whether requirement") && prompt.includes("REQ-01")) {
        return { ok: true, result: "", structuredOutput: { passed: fixApplied, gapDescription: fixApplied ? "" : "Missing feature" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      }

      // Fix step
      if (prompt.includes("INCREMENTAL FIX")) {
        fixApplied = true;
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    (ctx as any).fs = {
      readFileSync: (p: string) => {
        if (p === "REQUIREMENTS.md") return "## R1: Feature\nSome feature desc";
        throw new Error("Not found");
      },
      existsSync: () => false,
      writeFileSync: () => {},
      mkdirSync: () => {},
    };

    await runSpecComplianceLoop(["REQ-01"], ctx);

    // The incremental fix prompt should include requirements document
    const fixPrompt = capturedPrompts.find((p) => p.includes("INCREMENTAL FIX"));
    expect(fixPrompt).toBeDefined();
    expect(fixPrompt).toContain("Feature");
    expect(fixPrompt).toContain("Requirements Document");
  });

  it("TestSpecCompliance_ReadRequirementsDoc_ReturnsContent", () => {
    const mockFs = {
      readFileSync: (p: string) => {
        if (p === "REQUIREMENTS.md") return "# Requirements\n## R1: Test";
        throw new Error("Not found");
      },
    };
    expect(readRequirementsDoc(mockFs as any)).toBe("# Requirements\n## R1: Test");
  });

  it("TestSpecCompliance_ReadRequirementsDoc_ReturnsEmptyOnMissing", () => {
    const mockFs = {
      readFileSync: () => { throw new Error("ENOENT"); },
    };
    expect(readRequirementsDoc(mockFs as any)).toBe("");
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
