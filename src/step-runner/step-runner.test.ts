/**
 * Step Runner Unit Tests
 *
 * Tests for runStep() -- the core execution primitive.
 * All tests use mocked executeQuery and StateManager.
 *
 * Requirements tested: STEP-01, STEP-02, STEP-03, STEP-05, STEP-06,
 *                      COST-01, COST-02, COST-03, COST-04
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runStep } from "./step-runner.js";
import { CostController } from "./cost-controller.js";
import type { StepRunnerContext, StepOptions } from "./types.js";
import type { QueryResult, QuerySuccess, QueryFailure, CostData } from "../sdk/types.js";
import type { ForgeConfig } from "../config/schema.js";
import { StateManager } from "../state/state-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Test Helpers ───

function makeCostData(costUsd: number = 0.5): CostData {
  return {
    totalCostUsd: costUsd,
    numTurns: 5,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    modelUsage: {},
    durationMs: 1000,
    durationApiMs: 800,
  };
}

function makeSuccessResult(costUsd: number = 0.5): QuerySuccess {
  return {
    ok: true,
    result: "Step completed successfully",
    structuredOutput: undefined,
    sessionId: "test-session-123",
    cost: makeCostData(costUsd),
    permissionDenials: [],
  };
}

function makeFailureResult(
  category: QueryFailure["error"]["category"],
  costUsd: number = 0.3,
): QueryFailure {
  return {
    ok: false,
    error: {
      category,
      message: `Error: ${category}`,
      mayHavePartialWork: category === "budget_exceeded" || category === "execution_error",
    },
    sessionId: "test-session-err",
    cost: makeCostData(costUsd),
  };
}

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    model: "claude-sonnet-4-5-20250929",
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
      typecheck: true,
      lint: true,
      dockerSmoke: true,
      testCoverageCheck: true,
      observabilityCheck: true,
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

function makeContext(
  tmpDir: string,
  executeQueryFn: StepRunnerContext["executeQueryFn"],
  configOverrides: Partial<ForgeConfig> = {},
): StepRunnerContext {
  const stateManager = new StateManager(tmpDir);
  stateManager.initialize(tmpDir);
  return {
    config: makeConfig(configOverrides),
    stateManager,
    executeQueryFn,
  };
}

// ─── Tests ───

describe("runStep", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-step-test-"));
  });

  // STEP-01: runStep wraps executeQuery, runs verify, returns typed output
  it("TestRunStep_SuccessfulExecution_STEP01", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(0.5);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "test-step",
      {
        prompt: "Do something",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.costUsd).toBe(0.5);
      expect(result.result).toBe("Step completed successfully");
      expect(result.sessionId).toBe("test-session-123");
    }
  });

  // STEP-01: verify callback fails -> step failed
  it("TestRunStep_VerificationFails_STEP01", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(0.5);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "test-step",
      {
        prompt: "Do something",
        verify: async () => false,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("verification failed");
      expect(result.mayHavePartialWork).toBe(true);
    }
  });

  // STEP-02, COST-02: Budget hard-stop before starting
  it("TestRunStep_BudgetHardStop_STEP02", async () => {
    const mockExecuteQuery = async () => makeSuccessResult();
    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxBudgetTotal: 10 });

    // Set totalBudgetUsed to exceed the limit
    await ctx.stateManager.update((state) => ({
      ...state,
      totalBudgetUsed: 10.0,
    }));

    const costController = new CostController();

    const result = await runStep(
      "test-step",
      {
        prompt: "Should not run",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("budget_exceeded");
    if (result.status === "budget_exceeded") {
      expect(result.costUsd).toBe(0);
      expect(result.totalBudgetUsed).toBe(10.0);
      expect(result.maxBudgetTotal).toBe(10);
    }
  });

  // STEP-03, COST-04: Cost is tracked per step
  it("TestRunStep_CostTracking_STEP03", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(1.23);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    await runStep(
      "cost-test",
      {
        prompt: "Track cost",
        verify: async () => true,
        phase: 3,
      },
      ctx,
      costController,
    );

    // Cost log should have an entry
    const entries = costController.getCostByStep("cost-test");
    expect(entries).toHaveLength(1);
    expect(entries[0].costUsd).toBe(1.23);
    expect(entries[0].phase).toBe(3);

    // State should be updated
    const state = ctx.stateManager.load();
    expect(state.totalBudgetUsed).toBe(1.23);
  });

  // STEP-05: Budget exceeded mid-step, verify still runs
  it("TestRunStep_BudgetExceededMidStep_STEP05", async () => {
    const mockExecuteQuery = async () =>
      makeFailureResult("budget_exceeded", 0.8);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "budget-mid",
      {
        prompt: "Will hit budget",
        verify: async () => false, // partial work not enough
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.mayHavePartialWork).toBe(true);
      expect(result.error).toContain("budget exceeded");
    }
  });

  // STEP-05: Budget exceeded mid-step, but verify passes (partial work succeeded)
  it("TestRunStep_BudgetExceededMidStep_VerifyPasses_STEP05", async () => {
    const mockExecuteQuery = async () =>
      makeFailureResult("budget_exceeded", 0.8);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "budget-mid-pass",
      {
        prompt: "Will hit budget but work done",
        verify: async () => true, // partial work was enough!
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.costUsd).toBe(0.8);
    }
  });

  // STEP-06: SDK network error -- not retried, returned as error
  it("TestRunStep_SDKNetworkError_STEP06", async () => {
    const mockExecuteQuery = async () => makeFailureResult("network", 0.1);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "network-err",
      {
        prompt: "Will fail with network error",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.sdkError).toBe(true);
      expect(result.sdkErrorCategory).toBe("network");
    }
  });

  // STEP-06: SDK auth error -- not retried, returned as error
  it("TestRunStep_SDKAuthError_STEP06", async () => {
    const mockExecuteQuery = async () => makeFailureResult("auth", 0.0);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "auth-err",
      {
        prompt: "Will fail with auth error",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.sdkError).toBe(true);
      expect(result.sdkErrorCategory).toBe("auth");
    }
  });

  // COST-01: Per-step budget passed to executeQuery
  it("TestRunStep_PerStepBudget_COST01", async () => {
    let capturedMaxBudget: number | undefined;
    const mockExecuteQuery = async (opts: { maxBudgetUsd?: number }) => {
      capturedMaxBudget = opts.maxBudgetUsd;
      return makeSuccessResult();
    };
    const ctx = makeContext(tmpDir, mockExecuteQuery as StepRunnerContext["executeQueryFn"], {
      maxBudgetPerStep: 7.5,
    });
    const costController = new CostController();

    await runStep(
      "budget-pass",
      {
        prompt: "Check budget",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(capturedMaxBudget).toBe(7.5);
  });

  // COST-01: Per-step budget can be overridden
  it("TestRunStep_PerStepBudgetOverride_COST01", async () => {
    let capturedMaxBudget: number | undefined;
    const mockExecuteQuery = async (opts: { maxBudgetUsd?: number }) => {
      capturedMaxBudget = opts.maxBudgetUsd;
      return makeSuccessResult();
    };
    const ctx = makeContext(tmpDir, mockExecuteQuery as StepRunnerContext["executeQueryFn"], {
      maxBudgetPerStep: 7.5,
    });
    const costController = new CostController();

    await runStep(
      "budget-override",
      {
        prompt: "Check budget override",
        verify: async () => true,
        maxBudgetUsd: 3.0,
      },
      ctx,
      costController,
    );

    expect(capturedMaxBudget).toBe(3.0);
  });

  // COST-02: Project budget check before starting
  it("TestRunStep_ProjectBudgetCheck_COST02", async () => {
    let queryExecuted = false;
    const mockExecuteQuery = async () => {
      queryExecuted = true;
      return makeSuccessResult();
    };
    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxBudgetTotal: 5 });

    await ctx.stateManager.update((state) => ({
      ...state,
      totalBudgetUsed: 5.0,
    }));

    const costController = new CostController();
    await runStep(
      "budget-check",
      {
        prompt: "Should not execute",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    // executeQuery should NOT have been called
    expect(queryExecuted).toBe(false);
  });

  // COST-03: Phase budget updated in state
  it("TestRunStep_PhaseBudgetTracked_COST03", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(2.5);
    const ctx = makeContext(tmpDir, mockExecuteQuery);

    // Initialize phase 3 in state
    await ctx.stateManager.update((state) => ({
      ...state,
      phases: {
        "3": {
          status: "in_progress" as const,
          startedAt: new Date().toISOString(),
          attempts: 0,
          budgetUsed: 1.0,
        },
      },
    }));

    const costController = new CostController();

    await runStep(
      "phase-cost",
      {
        prompt: "Track phase cost",
        verify: async () => true,
        phase: 3,
      },
      ctx,
      costController,
    );

    const state = ctx.stateManager.load();
    // Phase budget should be 1.0 (initial) + 2.5 (this step)
    expect(state.phases["3"].budgetUsed).toBe(3.5);
  });

  // COST-04: Cost log entry created
  it("TestRunStep_CostLogged_COST04", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(0.77);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    await runStep(
      "log-test",
      {
        prompt: "Track cost log",
        verify: async () => true,
        phase: 2,
      },
      ctx,
      costController,
    );

    const log = costController.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].stepName).toBe("log-test");
    expect(log[0].costUsd).toBe(0.77);
    expect(log[0].phase).toBe(2);
    expect(log[0].status).toBe("verified");
    expect(log[0].sessionId).toBe("test-session-123");
    expect(log[0].timestamp).toBeTruthy();
  });

  // Execution error should return failed (not error)
  it("TestRunStep_ExecutionError_ReturnsFailed", async () => {
    const mockExecuteQuery = async () =>
      makeFailureResult("execution_error", 0.4);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "exec-err",
      {
        prompt: "Will fail during execution",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.mayHavePartialWork).toBe(true);
    }
  });

  // Verify that cost is tracked even when SDK returns an error
  it("TestRunStep_CostTrackedOnError_COST04", async () => {
    const mockExecuteQuery = async () => makeFailureResult("network", 0.15);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    await runStep(
      "error-cost",
      {
        prompt: "Error but still costs money",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    // Cost should still be logged
    const entries = costController.getCostByStep("error-cost");
    expect(entries).toHaveLength(1);
    expect(entries[0].costUsd).toBe(0.15);

    // State should be updated
    const state = ctx.stateManager.load();
    expect(state.totalBudgetUsed).toBe(0.15);
  });

  // Verify callback that throws is treated as failure
  it("TestRunStep_VerifyThrows_TreatedAsFailed", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(0.5);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "verify-throws",
      {
        prompt: "Verify will throw",
        verify: async () => {
          throw new Error("Verification crashed");
        },
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("failed");
  });

  // Structured output is preserved
  it("TestRunStep_StructuredOutput_Preserved", async () => {
    const mockExecuteQuery = async (): Promise<QueryResult> => ({
      ok: true,
      result: "done",
      structuredOutput: { key: "value", count: 42 },
      sessionId: "sess-1",
      cost: makeCostData(0.3),
      permissionDenials: [],
    });
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const result = await runStep(
      "structured",
      {
        prompt: "Return structured",
        verify: async () => true,
      },
      ctx,
      costController,
    );

    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.structuredOutput).toEqual({ key: "value", count: 42 });
    }
  });
});
