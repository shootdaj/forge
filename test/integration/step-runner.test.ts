/**
 * Step Runner Integration Tests
 *
 * Tests that runStep, CostController, and StateManager work together correctly.
 * Uses mocked executeQuery -- no real SDK calls.
 *
 * Requirements tested: STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06,
 *                      COST-01, COST-02, COST-03, COST-04
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runStep } from "../../src/step-runner/step-runner.js";
import { runStepWithCascade } from "../../src/step-runner/cascade.js";
import { CostController } from "../../src/step-runner/cost-controller.js";
import type { StepRunnerContext } from "../../src/step-runner/types.js";
import type {
  QueryResult,
  QuerySuccess,
  QueryFailure,
  CostData,
} from "../../src/sdk/types.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import { StateManager } from "../../src/state/state-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Test Helpers ───

function makeCostData(costUsd: number): CostData {
  return {
    totalCostUsd: costUsd,
    numTurns: 3,
    usage: {
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    modelUsage: {},
    durationMs: 500,
    durationApiMs: 400,
  };
}

function makeSuccessResult(costUsd: number): QuerySuccess {
  return {
    ok: true,
    result: "done",
    structuredOutput: undefined,
    sessionId: `sess-${costUsd}`,
    cost: makeCostData(costUsd),
    permissionDenials: [],
  };
}

function makeFailureResult(
  category: QueryFailure["error"]["category"],
  costUsd: number,
): QueryFailure {
  return {
    ok: false,
    error: {
      category,
      message: `Error: ${category}`,
      mayHavePartialWork: category === "execution_error",
    },
    sessionId: `sess-err-${costUsd}`,
    cost: makeCostData(costUsd),
  };
}

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    model: "claude-sonnet-4-5-20250929",
    maxBudgetTotal: 100,
    maxBudgetPerStep: 10,
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

// ─── Integration Tests ───

describe("Step Runner Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-integ-step-"));
  });

  // Full execution: runStep with mock query, verify state updates
  it("TestIntegration_StepRunner_FullExecution", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(1.5);
    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    // Set up a phase in state
    await stateManager.update((state) => ({
      ...state,
      phases: {
        "3": {
          status: "in_progress" as const,
          startedAt: new Date().toISOString(),
          attempts: 1,
          budgetUsed: 0,
        },
      },
    }));

    const ctx: StepRunnerContext = {
      config: makeConfig(),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    const result = await runStep(
      "integration-step",
      {
        prompt: "Build something",
        verify: async () => true,
        phase: 3,
      },
      ctx,
      costController,
    );

    // Step should succeed
    expect(result.status).toBe("verified");
    expect(result.costUsd).toBe(1.5);

    // State should be updated
    const state = stateManager.load();
    expect(state.totalBudgetUsed).toBe(1.5);
    expect(state.phases["3"].budgetUsed).toBe(1.5);

    // Cost log should have entry
    expect(costController.size).toBe(1);
    expect(costController.getPhaseTotal(3)).toBe(1.5);
  });

  // Budget enforcement: project budget check + per-step budget
  it("TestIntegration_StepRunner_BudgetEnforcement", async () => {
    let capturedMaxBudget: number | undefined;
    const mockExecuteQuery = async (opts: { maxBudgetUsd?: number }) => {
      capturedMaxBudget = opts.maxBudgetUsd;
      return makeSuccessResult(0.5);
    };

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    const ctx: StepRunnerContext = {
      config: makeConfig({ maxBudgetTotal: 50, maxBudgetPerStep: 8 }),
      stateManager,
      executeQueryFn: mockExecuteQuery as StepRunnerContext["executeQueryFn"],
    };
    const costController = new CostController();

    // Step should execute (under budget)
    const result = await runStep(
      "budget-test",
      { prompt: "Check budget", verify: async () => true },
      ctx,
      costController,
    );

    expect(result.status).toBe("verified");
    expect(capturedMaxBudget).toBe(8); // per-step budget passed through

    // Now set budget to exceed limit
    await stateManager.update((state) => ({
      ...state,
      totalBudgetUsed: 50.0,
    }));

    const result2 = await runStep(
      "budget-test-2",
      { prompt: "Should not run", verify: async () => true },
      ctx,
      costController,
    );

    expect(result2.status).toBe("budget_exceeded");
  });

  // Cost controller state integration: cost tracked across multiple steps
  it("TestIntegration_CostController_StateIntegration", async () => {
    let callIndex = 0;
    const costs = [1.0, 2.5, 0.75];
    const mockExecuteQuery = async (): Promise<QueryResult> => {
      const cost = costs[callIndex++] ?? 0;
      return makeSuccessResult(cost);
    };

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    const ctx: StepRunnerContext = {
      config: makeConfig(),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    // Run three steps
    for (const i of [0, 1, 2]) {
      await runStep(
        `step-${i}`,
        {
          prompt: `Step ${i}`,
          verify: async () => true,
          phase: i < 2 ? 1 : 2,
        },
        ctx,
        costController,
      );
    }

    // Cost controller should have all entries
    expect(costController.size).toBe(3);
    expect(costController.getPhaseTotal(1)).toBeCloseTo(3.5, 2); // 1.0 + 2.5
    expect(costController.getPhaseTotal(2)).toBeCloseTo(0.75, 2);
    expect(costController.getTotal()).toBeCloseTo(4.25, 2);

    // State should have accumulated total
    const state = stateManager.load();
    expect(state.totalBudgetUsed).toBeCloseTo(4.25, 2);
  });

  // Cascade with state updates: retry logic updates state correctly
  it("TestIntegration_Cascade_RetryWithStateUpdates", async () => {
    let callCount = 0;
    const mockExecuteQuery = async (): Promise<QueryResult> => {
      callCount++;
      if (callCount <= 2) {
        return makeFailureResult("execution_error", 0.5);
      }
      return makeSuccessResult(1.0);
    };

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    const ctx: StepRunnerContext = {
      config: makeConfig({ maxRetries: 3 }),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-integ",
      {
        prompt: "Will retry",
        verify: async () => callCount >= 3,
        phase: 1,
        onFailure: async (_error, attempt) => ({
          action: "retry" as const,
          newPrompt: `Retry ${attempt + 1}`,
          approach: `approach-${attempt + 1}`,
        }),
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("verified");
    expect(cascade.attempts).toHaveLength(2); // 2 failures before success

    // Total cost: 0.5 + 0.5 + 1.0 = 2.0
    expect(cascade.totalCostUsd).toBeCloseTo(2.0, 1);

    // State should reflect total cost
    const state = stateManager.load();
    expect(state.totalBudgetUsed).toBeCloseTo(2.0, 1);
  });
});
