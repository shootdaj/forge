/**
 * Cascade Unit Tests
 *
 * Tests for runStepWithCascade() -- the failure cascade wrapper.
 * All tests use mocked executeQuery and StateManager.
 *
 * Requirements tested: STEP-04, STEP-06
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runStepWithCascade } from "./cascade.js";
import { CostController } from "./cost-controller.js";
import type {
  StepRunnerContext,
  CascadeOptions,
  OnFailureDecision,
  AttemptRecord,
} from "./types.js";
import type {
  QueryResult,
  QuerySuccess,
  QueryFailure,
  CostData,
} from "../sdk/types.js";
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
    result: "Step completed",
    structuredOutput: undefined,
    sessionId: "sess-ok",
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
      mayHavePartialWork: category === "execution_error",
    },
    sessionId: "sess-err",
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

describe("runStepWithCascade", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-cascade-test-"));
  });

  // STEP-04: First attempt succeeds -- no retries needed
  it("TestRunStepWithCascade_FirstAttemptSucceeds_STEP04", async () => {
    const mockExecuteQuery = async () => makeSuccessResult(0.5);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-ok",
      {
        prompt: "Do it right the first time",
        verify: async () => true,
        onFailure: async () => ({ action: "retry" as const, newPrompt: "retry", approach: "retry-1" }),
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("verified");
    expect(cascade.attempts).toHaveLength(0); // no failures recorded
    expect(cascade.totalCostUsd).toBe(0.5);
  });

  // STEP-04: Fails first, succeeds on retry
  it("TestRunStepWithCascade_RetrySucceeds_STEP04", async () => {
    let callCount = 0;
    const mockExecuteQuery = async (): Promise<QueryResult> => {
      callCount++;
      if (callCount === 1) {
        // First call: execution error
        return makeFailureResult("execution_error", 0.3);
      }
      // Second call: success
      return makeSuccessResult(0.5);
    };

    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-retry",
      {
        prompt: "Try this",
        verify: async () => callCount >= 2, // passes after first failure
        onFailure: async (_error, attempt) => ({
          action: "retry" as const,
          newPrompt: `Retry attempt ${attempt + 1}: try different approach`,
          approach: `retry-${attempt}`,
        }),
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("verified");
    expect(cascade.attempts).toHaveLength(1); // one failure recorded
    expect(cascade.totalCostUsd).toBeCloseTo(0.8, 2); // 0.3 + 0.5
  });

  // STEP-04: All retries fail, then skip and flag
  it("TestRunStepWithCascade_AllRetriesFail_SkipAndFlag_STEP04", async () => {
    // Always return execution_error, verify always fails
    const mockExecuteQuery = async (): Promise<QueryResult> =>
      makeFailureResult("execution_error", 0.2);

    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxRetries: 3 });
    const costController = new CostController();

    let failureCallCount = 0;
    const cascade = await runStepWithCascade(
      "cascade-exhaust",
      {
        prompt: "Will keep failing",
        verify: async () => false,
        phase: 3,
        onFailure: async (_error, attempt, _history) => {
          failureCallCount++;
          if (attempt < 3) {
            return {
              action: "retry" as const,
              newPrompt: `Retry ${attempt + 1}`,
              approach: `approach-${attempt + 1}`,
            };
          }
          return {
            action: "skip" as const,
            reason: "All retries exhausted, skipping",
          };
        },
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("skipped");
    if (cascade.result.status === "skipped") {
      expect(cascade.result.attempts.length).toBeGreaterThanOrEqual(1);
    }

    // State should have a skipped item
    const state = ctx.stateManager.load();
    expect(state.skippedItems.length).toBeGreaterThanOrEqual(1);
    expect(state.skippedItems[0].requirement).toBe("cascade-exhaust");
    expect(state.skippedItems[0].phase).toBe(3);
  });

  // STEP-04: Error context passed to retry prompts
  it("TestRunStepWithCascade_ErrorContextInRetry_STEP04", async () => {
    let callCount = 0;
    const capturedHistories: AttemptRecord[][] = [];

    const mockExecuteQuery = async (): Promise<QueryResult> => {
      callCount++;
      if (callCount <= 2) {
        return makeFailureResult("execution_error", 0.2);
      }
      return makeSuccessResult(0.4);
    };

    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    await runStepWithCascade(
      "cascade-context",
      {
        prompt: "Initial attempt",
        verify: async () => callCount >= 3,
        onFailure: async (_error, _attempt, history) => {
          capturedHistories.push([...history]);
          return {
            action: "retry" as const,
            newPrompt: `Retry with context from ${history.length} prior failures`,
            approach: `approach-${history.length + 1}`,
          };
        },
      },
      ctx,
      costController,
    );

    // First failure callback should have 1 attempt in history
    expect(capturedHistories[0]).toHaveLength(1);
    expect(capturedHistories[0][0].error).toContain("execution_error");

    // Second failure callback should have 2 attempts in history
    expect(capturedHistories[1]).toHaveLength(2);
  });

  // STEP-06: SDK error not retried -- bypasses cascade entirely
  it("TestRunStepWithCascade_SDKErrorNotRetried_STEP06", async () => {
    let failureCalled = false;
    const mockExecuteQuery = async () => makeFailureResult("network", 0.1);
    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-sdk-err",
      {
        prompt: "Will hit SDK error",
        verify: async () => true,
        onFailure: async () => {
          failureCalled = true;
          return { action: "retry" as const, newPrompt: "retry", approach: "retry" };
        },
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("error");
    if (cascade.result.status === "error") {
      expect(cascade.result.sdkError).toBe(true);
      expect(cascade.result.sdkErrorCategory).toBe("network");
    }
    // onFailure should NOT have been called
    expect(failureCalled).toBe(false);
  });

  // STEP-04: Non-skippable step returns failed instead of skipped
  it("TestRunStepWithCascade_NonSkippable_Stop_STEP04", async () => {
    const mockExecuteQuery = async (): Promise<QueryResult> =>
      makeFailureResult("execution_error", 0.2);

    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxRetries: 1 });
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-nostop",
      {
        prompt: "Critical step",
        verify: async () => false,
        skippable: false,
        onFailure: async () => ({
          action: "skip" as const,
          reason: "Trying to skip",
        }),
      },
      ctx,
      costController,
    );

    // Should be failed, not skipped, because non-skippable
    expect(cascade.result.status).toBe("failed");
    if (cascade.result.status === "failed") {
      expect(cascade.result.error).toContain("Non-skippable");
    }
  });

  // STEP-04: Skipped items properly recorded in state
  it("TestRunStepWithCascade_SkippedItemRecorded_STEP04", async () => {
    const mockExecuteQuery = async (): Promise<QueryResult> =>
      makeFailureResult("execution_error", 0.2);

    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxRetries: 1 });
    const costController = new CostController();

    await runStepWithCascade(
      "record-skip",
      {
        prompt: "Will be skipped",
        verify: async () => false,
        phase: 5,
        onFailure: async () => ({
          action: "skip" as const,
          reason: "Cannot fix this automatically",
        }),
      },
      ctx,
      costController,
    );

    const state = ctx.stateManager.load();
    const skipped = state.skippedItems.find(
      (s) => s.requirement === "record-skip",
    );
    expect(skipped).toBeDefined();
    expect(skipped!.phase).toBe(5);
    expect(skipped!.attempts.length).toBeGreaterThanOrEqual(1);
  });

  // Budget exceeded at project level -- cascade does not retry
  it("TestRunStepWithCascade_BudgetExceeded_NoRetry", async () => {
    const mockExecuteQuery = async () => makeSuccessResult();
    const ctx = makeContext(tmpDir, mockExecuteQuery, { maxBudgetTotal: 5 });

    await ctx.stateManager.update((state) => ({
      ...state,
      totalBudgetUsed: 5.0,
    }));

    const costController = new CostController();
    let failureCalled = false;

    const cascade = await runStepWithCascade(
      "cascade-budget",
      {
        prompt: "Over budget",
        verify: async () => true,
        onFailure: async () => {
          failureCalled = true;
          return { action: "retry" as const, newPrompt: "retry", approach: "retry" };
        },
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("budget_exceeded");
    expect(failureCalled).toBe(false);
  });

  // Stop decision from onFailure
  it("TestRunStepWithCascade_StopDecision_STEP04", async () => {
    const mockExecuteQuery = async (): Promise<QueryResult> =>
      makeFailureResult("execution_error", 0.2);

    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-stop",
      {
        prompt: "Will be stopped",
        verify: async () => false,
        onFailure: async () => ({
          action: "stop" as const,
          reason: "Critical failure, must stop",
        }),
      },
      ctx,
      costController,
    );

    expect(cascade.result.status).toBe("failed");
    if (cascade.result.status === "failed") {
      expect(cascade.result.error).toContain("stopped");
    }
  });

  // Total cost accumulated across retries
  it("TestRunStepWithCascade_TotalCostAccumulated_COST04", async () => {
    let callCount = 0;
    const mockExecuteQuery = async (): Promise<QueryResult> => {
      callCount++;
      if (callCount <= 2) {
        return makeFailureResult("execution_error", 0.3);
      }
      return makeSuccessResult(0.5);
    };

    const ctx = makeContext(tmpDir, mockExecuteQuery);
    const costController = new CostController();

    const cascade = await runStepWithCascade(
      "cascade-cost",
      {
        prompt: "Track total cost",
        verify: async () => callCount >= 3,
        onFailure: async () => ({
          action: "retry" as const,
          newPrompt: "retry",
          approach: "retry",
        }),
      },
      ctx,
      costController,
    );

    expect(cascade.totalCostUsd).toBeCloseTo(1.1, 1); // 0.3 + 0.3 + 0.5
  });
});
