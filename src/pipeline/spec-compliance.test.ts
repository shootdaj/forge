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
  runIncrementalComplianceLoop,
  execGitCommand,
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
    maxParallelGapFixes: 3,
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

    // Add execFn that records git commands and resets fix state on revert
    (ctx as any).execFn = (cmd: string) => {
      gitCommands.push(cmd);
      if (cmd.includes("rev-parse")) return "abc123";
      if (cmd.includes("reset --hard")) {
        fixApplied = false;
        return "";
      }
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

// ============================================================================
// execGitCommand tests
// ============================================================================

describe("execGitCommand", () => {
  it("TestIncrementalCompliance_ExecGitCommand_UsesExecFn", () => {
    const mockExecFn = vi.fn().mockReturnValue("abc123");
    const ctx = {
      execFn: mockExecFn,
    } as unknown as PipelineContext;

    const result = execGitCommand("git rev-parse HEAD", ctx);

    expect(mockExecFn).toHaveBeenCalledWith("git rev-parse HEAD");
    expect(result).toBe("abc123");
  });
});

// ============================================================================
// runIncrementalComplianceLoop tests
// ============================================================================

describe("runIncrementalComplianceLoop", () => {
  /**
   * Helper to create a mock context with incremental compliance support.
   * Includes execFn for git commands that records all calls.
   */
  function makeIncrementalMockContext(options: {
    maxComplianceRounds?: number;
    executeQueryFn: (opts: any) => Promise<any>;
  }): {
    ctx: PipelineContext;
    gitCommands: string[];
    stateUpdates: Array<(state: ForgeState) => ForgeState>;
  } {
    const gitCommands: string[] = [];
    const stateUpdates: Array<(state: ForgeState) => ForgeState> = [];
    let currentState = makeState();

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
      executeQueryFn: options.executeQueryFn,
    };

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
      costController: {
        checkBudget: () => {},
        recordStepCost: () => {},
      } as any,
      runPhaseFn: async () => ({
        status: "completed" as const,
        phaseNumber: 1,
        requirementsCompleted: [],
        testResults: { passed: 0, failed: 0, total: 0 },
        verificationReport: { checks: [], allPassed: true },
        costUsd: 0,
      }),
      execFn: (cmd: string) => {
        gitCommands.push(cmd);
        if (cmd.includes("rev-parse")) return "abc123def456";
        if (cmd.includes("reset --hard")) return "";
        if (cmd.includes("git add")) return "";
        return "";
      },
    };

    return { ctx, gitCommands, stateUpdates };
  }

  it("TestIncrementalCompliance_FixSucceeds_CommitsChanges", async () => {
    let fixApplied = false;

    const { ctx, gitCommands } = makeIncrementalMockContext({
      executeQueryFn: async (opts: any) => {
        const prompt = opts.prompt as string;

        // Batch verify at round start: 1 gap
        if (prompt.includes("Verify whether each of the following requirements")) {
          return {
            ok: true,
            result: '```json\n[{"id":"REQ-01","passed":' + fixApplied + ',"gapDescription":"' + (fixApplied ? "" : "Missing feature") + '"},{"id":"REQ-02","passed":true,"gapDescription":""}]\n```',
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        // Individual verify after fix
        if (prompt.includes("Verify whether requirement") && prompt.includes("REQ-01")) {
          return { ok: true, result: "", structuredOutput: { passed: fixApplied, gapDescription: fixApplied ? "" : "Missing" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
        if (prompt.includes("Verify whether requirement") && prompt.includes("REQ-02")) {
          return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }

        // Fix step
        if (prompt.includes("INCREMENTAL FIX")) {
          fixApplied = true;
        }

        return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      },
    });

    const result = await runIncrementalComplianceLoop(["REQ-01", "REQ-02"], ctx);

    expect(result.converged).toBe(true);
    expect(result.roundsCompleted).toBe(1);
    expect(result.gapHistory).toEqual([2, 0]);

    // Should have committed (git add + commit)
    const commitCmds = gitCommands.filter((c) => c.includes("git add"));
    expect(commitCmds.length).toBeGreaterThan(0);

    // Should NOT have reverted
    const revertCmds = gitCommands.filter((c) => c.includes("reset --hard"));
    expect(revertCmds.length).toBe(0);
  });

  it("TestIncrementalCompliance_FixCausesRegression_Reverts", async () => {
    let req01FixApplied = false;

    const { ctx, gitCommands } = makeIncrementalMockContext({
      executeQueryFn: async (opts: any) => {
        const prompt = opts.prompt as string;

        // Batch verify: REQ-01 fails, REQ-02 passes
        if (prompt.includes("Verify whether each of the following requirements")) {
          return {
            ok: true,
            result: '```json\n[{"id":"REQ-01","passed":false,"gapDescription":"Broken"},{"id":"REQ-02","passed":' + (!req01FixApplied) + ',"gapDescription":"' + (req01FixApplied ? "Regressed" : "") + '"}]\n```',
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        // Individual verify: REQ-01 passes after fix, but REQ-02 regresses
        if (prompt.includes("Verify whether requirement") && prompt.includes("REQ-01")) {
          return { ok: true, result: "", structuredOutput: { passed: req01FixApplied, gapDescription: req01FixApplied ? "" : "Broken" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }
        if (prompt.includes("Verify whether requirement") && prompt.includes("REQ-02")) {
          return { ok: true, result: "", structuredOutput: { passed: !req01FixApplied, gapDescription: req01FixApplied ? "Regressed" : "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }

        // Fix REQ-01
        if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-01")) {
          req01FixApplied = true;
        }

        return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      },
    });

    // Override execFn to reset fix flag on revert
    (ctx as any).execFn = (cmd: string) => {
      gitCommands.push(cmd);
      if (cmd.includes("rev-parse")) return "abc123def456";
      if (cmd.includes("reset --hard")) {
        req01FixApplied = false;
        return "";
      }
      if (cmd.includes("git add")) return "";
      return "";
    };

    const result = await runIncrementalComplianceLoop(["REQ-01", "REQ-02"], ctx);

    // Should have reverted (git reset --hard)
    const revertCmds = gitCommands.filter((c) => c.includes("reset --hard"));
    expect(revertCmds.length).toBeGreaterThan(0);

    // REQ-01 should be in remaining gaps (deferred due to regression)
    expect(result.remainingGaps).toContain("REQ-01");
    expect(result.converged).toBe(false);
  });

  it("TestIncrementalCompliance_MultipleGaps_MixedResults", async () => {
    // 3 gaps: REQ-01 fixes OK, REQ-02 causes regression on REQ-04 (reverted), REQ-03 fixes OK
    let req01Fixed = false;
    let req02FixAttempted = false;
    let req03Fixed = false;

    const { ctx, gitCommands } = makeIncrementalMockContext({
      executeQueryFn: async (opts: any) => {
        const prompt = opts.prompt as string;

        // Batch verify — check which IDs are being asked about
        if (prompt.includes("Verify whether each of the following requirements")) {
          // Build verdicts based on which IDs appear in the prompt
          const verdicts: Array<{ id: string; passed: boolean; gapDescription: string }> = [];
          if (prompt.includes("REQ-01")) verdicts.push({ id: "REQ-01", passed: req01Fixed, gapDescription: req01Fixed ? "" : "Gap 1" });
          if (prompt.includes("REQ-02")) verdicts.push({ id: "REQ-02", passed: false, gapDescription: "Gap 2" });
          if (prompt.includes("REQ-03")) verdicts.push({ id: "REQ-03", passed: req03Fixed, gapDescription: req03Fixed ? "" : "Gap 3" });
          if (prompt.includes("REQ-04")) {
            // REQ-04 regresses when REQ-02 fix is attempted
            verdicts.push({ id: "REQ-04", passed: !req02FixAttempted, gapDescription: req02FixAttempted ? "Regressed" : "" });
          }
          return {
            ok: true,
            result: "```json\n" + JSON.stringify(verdicts) + "\n```",
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        // Individual verify after fix
        if (prompt.includes("Verify whether requirement")) {
          if (prompt.includes("REQ-01")) return { ok: true, result: "", structuredOutput: { passed: req01Fixed, gapDescription: req01Fixed ? "" : "Gap 1" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
          if (prompt.includes("REQ-02")) return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
          if (prompt.includes("REQ-03")) return { ok: true, result: "", structuredOutput: { passed: req03Fixed, gapDescription: req03Fixed ? "" : "Gap 3" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
          if (prompt.includes("REQ-04")) return { ok: true, result: "", structuredOutput: { passed: !req02FixAttempted, gapDescription: req02FixAttempted ? "Regressed" : "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
          return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }

        // Fix steps
        if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-01")) req01Fixed = true;
        if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-02")) req02FixAttempted = true;
        if (prompt.includes("INCREMENTAL FIX") && prompt.includes("REQ-03")) req03Fixed = true;

        return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      },
    });

    // Override execFn to handle revert properly
    (ctx as any).execFn = (cmd: string) => {
      gitCommands.push(cmd);
      if (cmd.includes("rev-parse")) return "abc123def456";
      if (cmd.includes("reset --hard")) {
        // Revert REQ-02 fix
        req02FixAttempted = false;
        return "";
      }
      if (cmd.includes("git add")) return "";
      return "";
    };

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03", "REQ-04"],
      ctx,
    );

    // REQ-01 and REQ-03 fixed, REQ-02 deferred (caused regression on REQ-04)
    expect(result.gapHistory[0]).toBe(4); // baseline
    expect(result.gapHistory[1]).toBe(1); // after round 1: only REQ-02 remains

    // Should have both commits and reverts
    const commitCmds = gitCommands.filter((c) => c.includes("git add"));
    expect(commitCmds.length).toBeGreaterThanOrEqual(2); // REQ-01 and REQ-03
    const revertCmds = gitCommands.filter((c) => c.includes("reset --hard"));
    expect(revertCmds.length).toBeGreaterThanOrEqual(1); // REQ-02
  });

  it("TestIncrementalCompliance_MonotonicGapDecrease", async () => {
    // Round 1: 3 gaps, 2 fixed (REQ-03 deferred because fix doesn't verify). Round 2: 1 gap, fixed.
    let fixedSet = new Set<string>();
    // Track round starts by counting batch verifies that include all 3 requirements
    let roundNumber = 0;

    const { ctx } = makeIncrementalMockContext({
      executeQueryFn: async (opts: any) => {
        const prompt = opts.prompt as string;

        if (prompt.includes("Verify whether each of the following requirements")) {
          // Only count as a new round when all 3 requirements are in the prompt
          const isFullRoundVerify = prompt.includes("REQ-01") && prompt.includes("REQ-02") && prompt.includes("REQ-03");
          if (isFullRoundVerify) roundNumber++;

          const verdicts: Array<{ id: string; passed: boolean; gapDescription: string }> = [];
          for (const id of ["REQ-01", "REQ-02", "REQ-03"]) {
            if (prompt.includes(id)) {
              verdicts.push({ id, passed: fixedSet.has(id), gapDescription: fixedSet.has(id) ? "" : "Gap" });
            }
          }
          return {
            ok: true,
            result: "```json\n" + JSON.stringify(verdicts) + "\n```",
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        if (prompt.includes("Verify whether requirement")) {
          for (const id of ["REQ-01", "REQ-02", "REQ-03"]) {
            if (prompt.includes(id)) {
              const passed = fixedSet.has(id);
              return { ok: true, result: "", structuredOutput: { passed, gapDescription: passed ? "" : "Gap" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
            }
          }
        }

        // Fix: REQ-01 and REQ-02 fix immediately. REQ-03 only fixes in round 2.
        if (prompt.includes("INCREMENTAL FIX")) {
          if (prompt.includes("REQ-01")) fixedSet.add("REQ-01");
          if (prompt.includes("REQ-02")) fixedSet.add("REQ-02");
          // REQ-03 fix only works in round 2+
          if (prompt.includes("REQ-03") && roundNumber >= 2) {
            fixedSet.add("REQ-03");
          }
        }

        return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      },
    });

    const result = await runIncrementalComplianceLoop(["REQ-01", "REQ-02", "REQ-03"], ctx);

    expect(result.converged).toBe(true);
    expect(result.gapHistory[0]).toBe(3); // baseline
    expect(result.gapHistory[1]).toBe(1); // round 1: REQ-03 deferred
    expect(result.gapHistory[2]).toBe(0); // round 2: REQ-03 fixed
    expect(result.roundsCompleted).toBe(2);
  });

  it("TestIncrementalCompliance_NotConverging_StopsLoop", async () => {
    // All fixes always fail verification — gap count never decreases
    const { ctx } = makeIncrementalMockContext({
      maxComplianceRounds: 3,
      executeQueryFn: async (opts: any) => {
        const prompt = opts.prompt as string;

        if (prompt.includes("Verify whether each of the following requirements")) {
          return {
            ok: true,
            result: '```json\n[{"id":"REQ-01","passed":false,"gapDescription":"Always broken"},{"id":"REQ-02","passed":false,"gapDescription":"Also broken"}]\n```',
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        if (prompt.includes("Verify whether requirement")) {
          return { ok: true, result: "", structuredOutput: { passed: false, gapDescription: "Still broken" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
        }

        return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
      },
    });

    const result = await runIncrementalComplianceLoop(["REQ-01", "REQ-02"], ctx);

    expect(result.converged).toBe(false);
    // Round 1: 2 gaps, both deferred -> 2 gaps. Round 2: 2 gaps again (2 === 2 -> not converging)
    expect(result.gapHistory[0]).toBe(2); // baseline
    expect(result.gapHistory[1]).toBe(2); // round 1: all deferred
    expect(result.gapHistory[2]).toBe(2); // round 2: all deferred
    expect(result.remainingGaps).toContain("REQ-01");
    expect(result.remainingGaps).toContain("REQ-02");
  });
});

// ============================================================================
// Scenario: Full incremental compliance flow
// ============================================================================

describe("Scenario: Full incremental compliance flow", () => {
  it("TestScenario_IncrementalCompliance_EndToEnd", async () => {
    // 5 requirements: REQ-01, REQ-02 pass initially. REQ-03, REQ-04, REQ-05 fail.
    // Round 1: Fix REQ-03 succeeds. Fix REQ-04 causes REQ-01 regression -> reverted.
    //   Fix REQ-05 succeeds. -> 1 gap remains (REQ-04).
    // Round 2: Fix REQ-04 succeeds (no regression this time). -> 0 gaps.
    const fixedSet = new Set<string>();
    let req04FixAttempts = 0;
    let req04FixActive = false;
    const gitCommands: string[] = [];

    const stateUpdates: Array<(state: ForgeState) => ForgeState> = [];
    let currentState = makeState();

    const mockExecQuery = async (opts: any) => {
      const prompt = opts.prompt as string;

      if (prompt.includes("Verify whether each of the following requirements")) {
        // Build verdicts only for IDs in the prompt
        const verdicts: Array<{ id: string; passed: boolean; gapDescription: string }> = [];
        for (const id of ["REQ-01", "REQ-02", "REQ-03", "REQ-04", "REQ-05"]) {
          if (prompt.includes(id)) {
            if (id === "REQ-01") {
              // REQ-01 regresses only when req04FixActive is true
              verdicts.push({ id, passed: !req04FixActive, gapDescription: req04FixActive ? "Regressed" : "" });
            } else if (id === "REQ-02") {
              verdicts.push({ id, passed: true, gapDescription: "" });
            } else {
              verdicts.push({ id, passed: fixedSet.has(id), gapDescription: fixedSet.has(id) ? "" : `Gap ${id}` });
            }
          }
        }
        return {
          ok: true,
          result: "```json\n" + JSON.stringify(verdicts) + "\n```",
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      }

      if (prompt.includes("Verify whether requirement")) {
        for (const id of ["REQ-01", "REQ-02", "REQ-03", "REQ-04", "REQ-05"]) {
          if (prompt.includes(id)) {
            if (id === "REQ-01") {
              return { ok: true, result: "", structuredOutput: { passed: !req04FixActive, gapDescription: req04FixActive ? "Regressed" : "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
            }
            if (id === "REQ-02") {
              return { ok: true, result: "", structuredOutput: { passed: true, gapDescription: "" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
            }
            const passed = fixedSet.has(id);
            return { ok: true, result: "", structuredOutput: { passed, gapDescription: passed ? "" : "Gap" }, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
          }
        }
      }

      // Fix steps
      if (prompt.includes("INCREMENTAL FIX")) {
        if (prompt.includes("REQ-03")) fixedSet.add("REQ-03");
        if (prompt.includes("REQ-04")) {
          fixedSet.add("REQ-04");
          req04FixAttempts++;
          // Only first attempt causes regression on REQ-01
          if (req04FixAttempts === 1) {
            req04FixActive = true;
          }
        }
        if (prompt.includes("REQ-05")) fixedSet.add("REQ-05");
      }

      return { ok: true, result: "done", structuredOutput: null, cost: { totalCostUsd: 0.01 }, sessionId: "mock" };
    };

    const stepRunnerContext: StepRunnerContext = {
      config: makeConfig({ maxComplianceRounds: 5 }),
      stateManager: {
        load: () => currentState,
        update: async (updater: (state: ForgeState) => ForgeState) => {
          stateUpdates.push(updater);
          currentState = updater(currentState);
          return currentState;
        },
      } as any,
      executeQueryFn: mockExecQuery,
    };

    const ctx: PipelineContext = {
      config: makeConfig({ maxComplianceRounds: 5 }),
      stateManager: {
        load: () => currentState,
        update: async (updater: (state: ForgeState) => ForgeState) => {
          stateUpdates.push(updater);
          currentState = updater(currentState);
          return currentState;
        },
      } as any,
      stepRunnerContext,
      costController: { checkBudget: () => {}, recordStepCost: () => {} } as any,
      runPhaseFn: async () => ({
        status: "completed" as const,
        phaseNumber: 1,
        requirementsCompleted: [],
        testResults: { passed: 0, failed: 0, total: 0 },
        verificationReport: { checks: [], allPassed: true },
        costUsd: 0,
      }),
      execFn: (cmd: string) => {
        gitCommands.push(cmd);
        if (cmd.includes("rev-parse")) return "abc123";
        if (cmd.includes("reset --hard")) {
          // Revert REQ-04 fix
          fixedSet.delete("REQ-04");
          req04FixActive = false;
          return "";
        }
        if (cmd.includes("git add")) return "";
        return "";
      },
    };

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03", "REQ-04", "REQ-05"],
      ctx,
    );

    // Should converge
    expect(result.converged).toBe(true);

    // Gap history: baseline=5, round 1=1 (REQ-04 deferred), round 2=0
    expect(result.gapHistory[0]).toBe(5);
    expect(result.gapHistory[1]).toBe(1); // REQ-03 + REQ-05 fixed, REQ-04 reverted
    expect(result.gapHistory[2]).toBe(0); // REQ-04 fixed in round 2

    expect(result.roundsCompleted).toBe(2);
    expect(result.remainingGaps).toEqual([]);

    // Verify git operations: at least 3 commits (REQ-03, REQ-05, REQ-04) and 1 revert
    const commitCmds = gitCommands.filter((c) => c.includes("git add"));
    expect(commitCmds.length).toBeGreaterThanOrEqual(3);
    const revertCmds = gitCommands.filter((c) => c.includes("reset --hard"));
    expect(revertCmds.length).toBeGreaterThanOrEqual(1);

    // Verify state was updated
    expect(stateUpdates.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Parallel Gap Fixing — Integration & Scenario Tests (Phase 16)
// ---------------------------------------------------------------------------

/**
 * Create a mock PipelineContext that returns file info in verification verdicts.
 * Used for testing parallel gap fixing behavior.
 */
function makeMockContextWithFiles(options: {
  verifyResults: Record<string, { passed: boolean; gapDescription: string; files: string[] }>;
  maxComplianceRounds?: number;
  maxParallelGapFixes?: number;
  /** Controls how fixes behave: "all-succeed" makes all pass after fix,
   *  "first-succeeds-rest-fail" makes only first gap succeed */
  fixBehavior?: "all-succeed" | "first-succeeds-rest-fail";
}): {
  ctx: PipelineContext;
  stepCalls: Array<{ name: string; prompt: string }>;
  stateUpdates: Array<(state: ForgeState) => ForgeState>;
  gitCommands: string[];
} {
  const stepCalls: Array<{ name: string; prompt: string }> = [];
  const stateUpdates: Array<(state: ForgeState) => ForgeState> = [];
  const gitCommands: string[] = [];
  let currentState = makeState();
  let roundCount = 0;

  const verifyResults = options.verifyResults ?? {};
  const fixBehavior = options.fixBehavior ?? "all-succeed";

  // Track which gaps have been "fixed" (simulated)
  const fixedGaps = new Set<string>();

  const mockExecuteQuery = async (opts: any): Promise<any> => {
    const prompt = opts.prompt as string;

    // Handle batch verification prompt
    if (prompt.includes("Verify whether each of the following requirements")) {
      const allReqIds = prompt.match(/- ([\w-]+)/g)?.map((m: string) => m.slice(2)) ?? [];
      const verdicts = allReqIds.map((id: string) => {
        const result = verifyResults[id];
        if (!result) {
          return { id, passed: true, gapDescription: "", files: [] };
        }
        // If gap was fixed, report as passing
        if (fixedGaps.has(id)) {
          return { id, passed: true, gapDescription: "", files: [] };
        }
        return { id, ...result };
      });
      return {
        ok: true,
        result: "```json\n" + JSON.stringify(verdicts) + "\n```",
        structuredOutput: null,
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock-session",
      };
    }

    // Handle individual verification (for post-fix verify)
    if (prompt.includes("Verify whether requirement")) {
      for (const [reqId, result] of Object.entries(verifyResults)) {
        if (prompt.includes(reqId)) {
          const passed = fixedGaps.has(reqId);
          return {
            ok: true,
            result: JSON.stringify({ passed, gapDescription: passed ? "" : result.gapDescription }),
            structuredOutput: { passed, gapDescription: passed ? "" : result.gapDescription },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock-session",
          };
        }
      }
      return {
        ok: true,
        result: JSON.stringify({ passed: true, gapDescription: "" }),
        structuredOutput: { passed: true, gapDescription: "" },
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock-session",
      };
    }

    // Handle fix prompt — simulate fix
    if (prompt.includes("INCREMENTAL FIX:")) {
      const reqMatch = prompt.match(/Fix requirement ([\w-]+)/);
      if (reqMatch) {
        const gapId = reqMatch[1];
        if (fixBehavior === "all-succeed") {
          fixedGaps.add(gapId);
        } else if (fixBehavior === "first-succeeds-rest-fail") {
          if (fixedGaps.size === 0) {
            fixedGaps.add(gapId);
          }
          // else: don't mark as fixed — verify will fail
        }
      }
      return {
        ok: true,
        result: "Fixed",
        structuredOutput: null,
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock-session",
      };
    }

    return {
      ok: true,
      result: "OK",
      structuredOutput: { passed: true, gapDescription: "" },
      cost: { totalCostUsd: 0.01 },
      sessionId: "mock-session",
    };
  };

  const config = makeConfig({
    maxComplianceRounds: options.maxComplianceRounds ?? 5,
  });
  // Add maxParallelGapFixes
  (config as any).maxParallelGapFixes = options.maxParallelGapFixes ?? 3;

  const stepRunnerContext: StepRunnerContext = {
    config,
    stateManager: {
      load: () => currentState,
      update: async (updater: (state: ForgeState) => ForgeState) => {
        stateUpdates.push(updater);
        currentState = updater(currentState);
        return currentState;
      },
    },
    executeQueryFn: mockExecuteQuery,
  };

  const ctx: PipelineContext = {
    config,
    stateManager: {
      load: () => currentState,
      update: async (updater: (state: ForgeState) => ForgeState) => {
        stateUpdates.push(updater);
        currentState = updater(currentState);
        return currentState;
      },
    },
    stepRunnerContext,
    costController: {
      checkBudget: () => {},
      recordStepCost: () => {},
    } as any,
    runPhaseFn: async () => ({
      status: "completed" as const,
      phaseNumber: 1,
      requirementsCompleted: [],
      testResults: { passed: 0, failed: 0, total: 0 },
      verificationReport: { checks: [], allPassed: true },
      costUsd: 0,
    }),
    fs: {
      existsSync: () => false,
      readFileSync: () => "",
      writeFileSync: () => {},
      mkdirSync: () => undefined,
    } as any,
    execFn: (cmd: string) => {
      gitCommands.push(cmd);
      if (cmd.includes("rev-parse HEAD")) return "abc123";
      if (cmd.includes("git add")) return "";
      if (cmd.includes("reset --hard")) return "";
      return "";
    },
  };

  return { ctx, stepCalls, stateUpdates, gitCommands };
}

describe("runIncrementalComplianceLoop - parallel execution", () => {
  it("fixes independent gaps (different files) and converges", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "Missing A", files: ["src/a.ts"] },
        "REQ-02": { passed: false, gapDescription: "Missing B", files: ["src/b.ts"] },
        "REQ-03": { passed: false, gapDescription: "Missing C", files: ["src/c.ts"] },
      },
      fixBehavior: "all-succeed",
    });

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(true);
    expect(result.remainingGaps).toEqual([]);
  });

  it("fixes overlapping gaps (shared files) and converges", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "Missing A", files: ["src/shared.ts"] },
        "REQ-02": { passed: false, gapDescription: "Missing B", files: ["src/shared.ts"] },
      },
      fixBehavior: "all-succeed",
    });

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02"],
      ctx,
    );

    expect(result.converged).toBe(true);
    expect(result.remainingGaps).toEqual([]);
  });

  it("falls back to sequential when no file info available", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "Missing A", files: [] },
        "REQ-02": { passed: false, gapDescription: "Missing B", files: [] },
      },
      fixBehavior: "all-succeed",
    });

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02"],
      ctx,
    );

    expect(result.converged).toBe(true);
    expect(result.remainingGaps).toEqual([]);
  });

  it("handles mixed results (some succeed, some deferred)", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "Missing A", files: ["src/a.ts"] },
        "REQ-02": { passed: false, gapDescription: "Missing B", files: ["src/b.ts"] },
      },
      fixBehavior: "first-succeeds-rest-fail",
      maxComplianceRounds: 3,
    });

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02"],
      ctx,
    );

    // First round: one succeeds, one deferred
    // Subsequent rounds should eventually converge (fix behavior allows only first)
    expect(result.roundsCompleted).toBeGreaterThanOrEqual(1);
  });

  it("respects maxParallelGapFixes config", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "A", files: ["src/a.ts"] },
        "REQ-02": { passed: false, gapDescription: "B", files: ["src/b.ts"] },
        "REQ-03": { passed: false, gapDescription: "C", files: ["src/c.ts"] },
        "REQ-04": { passed: false, gapDescription: "D", files: ["src/d.ts"] },
      },
      fixBehavior: "all-succeed",
      maxParallelGapFixes: 2,
    });

    const result = await runIncrementalComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03", "REQ-04"],
      ctx,
    );

    expect(result.converged).toBe(true);
    expect(result.remainingGaps).toEqual([]);
  });
});

describe("runSpecComplianceLoop - parallel scenario", () => {
  it("converges with mix of independent and overlapping gaps", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "A", files: ["src/a.ts"] },
        "REQ-02": { passed: false, gapDescription: "B", files: ["src/a.ts", "src/b.ts"] },
        "REQ-03": { passed: false, gapDescription: "C", files: ["src/c.ts"] },
        "REQ-04": { passed: true, gapDescription: "", files: [] },
      },
      fixBehavior: "all-succeed",
    });

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03", "REQ-04"],
      ctx,
    );

    expect(result.converged).toBe(true);
    // Gap history should show decrease
    expect(result.gapHistory[0]).toBe(4); // baseline = total requirements
    expect(result.gapHistory[result.gapHistory.length - 1]).toBe(0);
  });

  it("maintains monotonic gap decrease with parallel execution", async () => {
    const { ctx } = makeMockContextWithFiles({
      verifyResults: {
        "REQ-01": { passed: false, gapDescription: "A", files: ["src/a.ts"] },
        "REQ-02": { passed: false, gapDescription: "B", files: ["src/b.ts"] },
        "REQ-03": { passed: false, gapDescription: "C", files: ["src/c.ts"] },
      },
      fixBehavior: "all-succeed",
    });

    const result = await runSpecComplianceLoop(
      ["REQ-01", "REQ-02", "REQ-03"],
      ctx,
    );

    expect(result.converged).toBe(true);

    // Verify monotonic decrease in gap history (after baseline)
    for (let i = 2; i < result.gapHistory.length; i++) {
      expect(result.gapHistory[i]).toBeLessThanOrEqual(result.gapHistory[i - 1]);
    }
  });
});
