/**
 * Step Runner Scenario Tests
 *
 * End-to-end scenarios exercising the full step runner workflow.
 * Covers realistic usage patterns with mocked SDK.
 *
 * Requirements tested: STEP-01..06, COST-01..04
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
    sessionId: `sess-err`,
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

// ─── Scenario Tests ───

describe("Step Runner Scenarios", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-scenario-step-"));
  });

  /**
   * Scenario: A phase runner executes multiple steps with budget enforcement.
   *
   * Simulates a real phase execution:
   * 1. Context step: $1.50
   * 2. Plan step: $2.00
   * 3. Execute step: $5.00
   * 4. Verify step: $0.50
   *
   * Verifies: cost accumulates, per-step budget enforced, phase total correct.
   *
   * Requirements: STEP-01, STEP-03, COST-01, COST-03, COST-04
   */
  it("TestScenario_StepExecution_BudgetEnforcement_CostTracking", async () => {
    const stepCosts = [1.5, 2.0, 5.0, 0.5];
    let stepIndex = 0;

    const mockExecuteQuery = async (): Promise<QueryResult> => {
      const cost = stepCosts[stepIndex++];
      return makeSuccessResult(cost);
    };

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    // Initialize phase in state
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
      config: makeConfig({ maxBudgetTotal: 50, maxBudgetPerStep: 10 }),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    const stepNames = ["context", "plan", "execute", "verify-work"];

    for (const name of stepNames) {
      const result = await runStep(
        name,
        {
          prompt: `Run ${name}`,
          verify: async () => true,
          phase: 3,
        },
        ctx,
        costController,
      );
      expect(result.status).toBe("verified");
    }

    // Verify total cost
    expect(costController.getTotal()).toBeCloseTo(9.0, 1);
    expect(costController.getPhaseTotal(3)).toBeCloseTo(9.0, 1);

    // Verify state
    const state = stateManager.load();
    expect(state.totalBudgetUsed).toBeCloseTo(9.0, 1);
    expect(state.phases["3"].budgetUsed).toBeCloseTo(9.0, 1);

    // Verify cost log entries
    const log = costController.getLog();
    expect(log).toHaveLength(4);
    expect(log.map((e) => e.stepName)).toEqual(stepNames);
  });

  /**
   * Scenario: Cascade retries then skips a failing step.
   *
   * Simulates:
   * 1. Initial attempt fails (execution_error)
   * 2. Retry 1 fails (execution_error)
   * 3. Retry 2 fails (execution_error)
   * 4. Cascade skips the step
   *
   * Verifies: all retries attempted, skipped item in state, cost accumulated.
   *
   * Requirements: STEP-04, COST-04
   */
  it("TestScenario_CascadeFailure_RetryAndSkip", async () => {
    const mockExecuteQuery = async (): Promise<QueryResult> =>
      makeFailureResult("execution_error", 0.5);

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    const ctx: StepRunnerContext = {
      config: makeConfig({ maxRetries: 3 }),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    let retryCount = 0;
    const cascade = await runStepWithCascade(
      "failing-feature",
      {
        prompt: "Build WebSocket auth",
        verify: async () => false,
        phase: 4,
        onFailure: async (error, attempt, history) => {
          retryCount++;
          if (attempt < 3) {
            return {
              action: "retry" as const,
              newPrompt: `Previous ${history.length} attempts failed with: ${history.map((h) => h.error).join("; ")}. Try a completely different approach.`,
              approach: `alternative-approach-${attempt + 1}`,
            };
          }
          return {
            action: "skip" as const,
            reason: `Failed after ${history.length} attempts. Tried: ${history.map((h) => h.approach).join(", ")}`,
          };
        },
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("skipped");
    expect(retryCount).toBe(3); // onFailure called 3 times

    // Skipped item recorded in state
    const state = stateManager.load();
    expect(state.skippedItems).toHaveLength(1);
    expect(state.skippedItems[0].requirement).toBe("failing-feature");
    expect(state.skippedItems[0].phase).toBe(4);
    expect(state.skippedItems[0].attempts.length).toBeGreaterThanOrEqual(1);

    // Cost accumulated across all attempts
    expect(cascade.totalCostUsd).toBeGreaterThan(0);
  });

  /**
   * Scenario: Multiple steps across phases, cost tracked separately.
   *
   * Simulates:
   * - Phase 1: 2 steps ($1.0 + $2.0 = $3.0)
   * - Phase 2: 3 steps ($0.5 + $1.5 + $0.25 = $2.25)
   * - Total: $5.25
   *
   * Requirements: COST-03, COST-04
   */
  it("TestScenario_MultiStepPhase_CostAccumulation", async () => {
    const costs = [1.0, 2.0, 0.5, 1.5, 0.25];
    let idx = 0;
    const mockExecuteQuery = async () => makeSuccessResult(costs[idx++]);

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    // Initialize phases
    await stateManager.update((state) => ({
      ...state,
      phases: {
        "1": {
          status: "in_progress" as const,
          startedAt: new Date().toISOString(),
          attempts: 1,
          budgetUsed: 0,
        },
        "2": {
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

    // Phase 1 steps
    for (const name of ["p1-context", "p1-execute"]) {
      await runStep(
        name,
        { prompt: `Run ${name}`, verify: async () => true, phase: 1 },
        ctx,
        costController,
      );
    }

    // Phase 2 steps
    for (const name of ["p2-context", "p2-execute", "p2-verify"]) {
      await runStep(
        name,
        { prompt: `Run ${name}`, verify: async () => true, phase: 2 },
        ctx,
        costController,
      );
    }

    // Phase cost totals
    expect(costController.getPhaseTotal(1)).toBeCloseTo(3.0, 2);
    expect(costController.getPhaseTotal(2)).toBeCloseTo(2.25, 2);
    expect(costController.getTotal()).toBeCloseTo(5.25, 2);

    // State reflects phase budgets
    const state = stateManager.load();
    expect(state.phases["1"].budgetUsed).toBeCloseTo(3.0, 2);
    expect(state.phases["2"].budgetUsed).toBeCloseTo(2.25, 2);
    expect(state.totalBudgetUsed).toBeCloseTo(5.25, 2);
  });

  /**
   * Scenario: SDK error flows through without retry.
   *
   * Simulates a network error on the first step.
   * Verifies the error is returned immediately without cascade.
   *
   * Requirements: STEP-06
   */
  it("TestScenario_SDKError_NoRetry_ImmediateReturn", async () => {
    let queryCallCount = 0;
    const mockExecuteQuery = async (): Promise<QueryResult> => {
      queryCallCount++;
      return makeFailureResult("auth", 0.0);
    };

    const stateManager = new StateManager(tmpDir);
    stateManager.initialize(tmpDir);

    const ctx: StepRunnerContext = {
      config: makeConfig(),
      stateManager,
      executeQueryFn: mockExecuteQuery,
    };
    const costController = new CostController();

    let failureCalled = false;
    const cascade = await runStepWithCascade(
      "sdk-err-scenario",
      {
        prompt: "Will fail with auth error",
        verify: async () => true,
        onFailure: async () => {
          failureCalled = true;
          return { action: "retry" as const, newPrompt: "retry", approach: "retry" };
        },
      },
      ctx,
      costController,
    );

    // Error returned immediately
    expect(cascade.result.status).toBe("error");
    if (cascade.result.status === "error") {
      expect(cascade.result.sdkError).toBe(true);
      expect(cascade.result.sdkErrorCategory).toBe("auth");
    }

    // No retry -- executeQuery called only once
    expect(queryCallCount).toBe(1);
    expect(failureCalled).toBe(false);
    expect(cascade.attempts).toHaveLength(0);
  });
});
