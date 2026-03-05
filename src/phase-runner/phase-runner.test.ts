/**
 * Phase Runner Unit Tests
 *
 * Tests the main runPhase() orchestrator as a checkpoint sequencer.
 * All external dependencies (runStep, runStepWithCascade, runVerifiers,
 * StateManager) are mocked. The phase runner is tested for its
 * sequencing logic, not its SDK interaction.
 *
 * Requirements: PHA-01, PHA-04, PHA-06, PHA-07, PHA-08, PHA-11, PHA-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import type { PhaseRunnerContext } from "./types.js";
import {
  CONTEXT_FILE,
  PLAN_FILE,
  EXECUTION_MARKER,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
} from "./types.js";
import type { ForgeConfig } from "../config/schema.js";
import type { StepRunnerContext } from "../step-runner/types.js";

// Mock step-runner and verifiers modules at the top level
vi.mock("../step-runner/index.js", () => ({
  runStep: vi.fn(),
  runStepWithCascade: vi.fn(),
}));

vi.mock("../verifiers/index.js", () => ({
  runVerifiers: vi.fn(),
}));

// Import mocked modules
import { runStep, runStepWithCascade } from "../step-runner/index.js";
import { runVerifiers } from "../verifiers/index.js";
import { runPhase } from "./phase-runner.js";

// -------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------

/** Minimal ForgeConfig for testing */
function createTestConfig(): ForgeConfig {
  return {
    model: "test-model",
    maxBudgetTotal: 100,
    maxBudgetPerStep: 10,
    maxRetries: 3,
    maxComplianceRounds: 5,
    maxTurnsPerStep: 200,
    testing: {
      stack: "node",
      unitCommand: "npm test",
      integrationCommand: "npm run test:integration",
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
  };
}

/** In-memory filesystem for testing */
function createInMemoryFs() {
  const files = new Map<string, string>();

  return {
    files,
    existsSync: (filePath: string): boolean => {
      return files.has(filePath);
    },
    readFileSync: (filePath: string | Buffer | URL, _encoding?: string): string => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      }
      return content;
    },
    writeFileSync: (
      filePath: string | Buffer | URL,
      content: string,
      _encoding?: string,
    ): void => {
      const p = typeof filePath === "string" ? filePath : filePath.toString();
      files.set(p, content);
    },
    mkdirSync: (_dirPath: string | Buffer | URL, _opts?: unknown): string | undefined => {
      return undefined;
    },
  };
}

/** Mock StateManager */
function createMockStateManager() {
  const state = {
    projectDir: "/test",
    startedAt: new Date().toISOString(),
    model: "test",
    requirementsDoc: "REQUIREMENTS.md",
    status: "wave_1" as const,
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {} as Record<string, unknown>,
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
      status: "not_started" as const,
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 0,
  };

  return {
    load: vi.fn().mockReturnValue(state),
    save: vi.fn(),
    update: vi.fn().mockImplementation(async (updater: (s: typeof state) => typeof state) => {
      const updated = updater(state);
      Object.assign(state, updated);
      return updated;
    }),
    exists: vi.fn().mockReturnValue(true),
    statePath: "/test/forge-state.json",
    initialize: vi.fn().mockReturnValue(state),
    _state: state,
  };
}

/** Mock CostController */
function createMockCostController() {
  return {
    checkBudget: vi.fn(),
    recordStepCost: vi.fn(),
    getCostByStep: vi.fn().mockReturnValue([]),
    getCostByPhase: vi.fn().mockReturnValue([]),
    getPhaseTotal: vi.fn().mockReturnValue(0),
    getTotal: vi.fn().mockReturnValue(0),
    getLog: vi.fn().mockReturnValue([]),
    size: 0,
  };
}

/** Verified step result for mock returns */
function verifiedResult() {
  return {
    status: "verified" as const,
    costUsd: 0.5,
    costData: {
      totalCostUsd: 0.5,
      numTurns: 5,
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      modelUsage: {},
      durationMs: 1000,
      durationApiMs: 800,
    },
    result: "Done",
    structuredOutput: undefined,
    sessionId: "test-session",
  };
}

/** Verified cascade result for mock returns */
function verifiedCascadeResult() {
  return {
    result: verifiedResult(),
    attempts: [],
    totalCostUsd: 0.5,
  };
}

/** Passing verification report */
function passingVerificationReport() {
  return {
    passed: true,
    results: [
      { passed: true, verifier: "tests", details: ["All passed"], errors: [] },
      { passed: true, verifier: "typecheck", details: ["Clean"], errors: [] },
    ],
    summary: { total: 2, passed: 2, failed: 0, skipped: 0 },
    durationMs: 500,
  };
}

/** Failing verification report */
function failingVerificationReport() {
  return {
    passed: false,
    results: [
      { passed: false, verifier: "tests", details: [], errors: ["2 tests failed"] },
      { passed: true, verifier: "typecheck", details: ["Clean"], errors: [] },
    ],
    summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
    durationMs: 500,
  };
}

/** Create a full mock PhaseRunnerContext */
function createMockPhaseRunnerContext(
  inMemFs: ReturnType<typeof createInMemoryFs>,
) {
  const config = createTestConfig();
  const stateManager = createMockStateManager();
  const costController = createMockCostController();

  const stepRunnerContext: StepRunnerContext = {
    config,
    stateManager: stateManager as unknown as StepRunnerContext["stateManager"],
    executeQueryFn: vi.fn().mockResolvedValue({
      ok: true,
      result: "Done",
      structuredOutput: undefined,
      sessionId: "test",
      cost: {
        totalCostUsd: 0.5,
        numTurns: 5,
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        modelUsage: {},
        durationMs: 0,
        durationApiMs: 0,
      },
      permissionDenials: [],
    }),
  };

  const ctx: PhaseRunnerContext = {
    config,
    stateManager: stateManager as unknown as PhaseRunnerContext["stateManager"],
    stepRunnerContext,
    costController: costController as unknown as PhaseRunnerContext["costController"],
    fs: inMemFs as unknown as PhaseRunnerContext["fs"],
  };

  return { ctx, stateManager, costController, config };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("PhaseRunner", () => {
  let inMemFs: ReturnType<typeof createInMemoryFs>;
  let phaseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemFs = createInMemoryFs();

    // resolvePhaseDir creates the directory -- in our mock fs, mkdirSync is a no-op
    // We need to compute what the phase dir will be so we can set up files
    phaseDir = path.join(process.cwd(), ".planning", "phases", "05-phase-5");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestPhaseRunner_FullLifecycle_Success", async () => {
    const { ctx, stateManager } = createMockPhaseRunnerContext(inMemFs);

    // Set up: runStep writes checkpoint files on success
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name, opts) => {
      // Simulate the agent writing checkpoint files
      if (name.includes("context")) {
        inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
      } else if (name.includes("plan")) {
        // Write a plan that covers requirements and has test tasks
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02\nTask 1: implement\nTask 2: test tests testing",
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      const result = verifiedResult();
      return result;
    });

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(passingVerificationReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01", "PHA-02"],
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.report).toContain("PHASE_REPORT.md");
    }

    // Verify state was updated to in_progress and completed
    expect(stateManager.update).toHaveBeenCalled();
  });

  it("TestPhaseRunner_SkipsCompletedSubsteps", async () => {
    const { ctx } = createMockPhaseRunnerContext(inMemFs);

    // Pre-populate checkpoint files
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: build\nTask 2: test testing",
    );
    inMemFs.files.set(
      path.join(phaseDir, EXECUTION_MARKER),
      "done",
    );
    inMemFs.files.set(
      path.join(phaseDir, VERIFICATION_FILE),
      "# Verification",
    );
    inMemFs.files.set(path.join(phaseDir, GAPS_FILE), "# Gaps");
    inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");

    // These should NOT be called since everything is done
    const mockedRunStep = vi.mocked(runStep);
    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    const mockedRunVerifiers = vi.mocked(runVerifiers);

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // No substep should have been called (only plan verification runs -- it's idempotent)
    // But runStep may be called for plan verification if replan is needed
    // Since the plan covers PHA-01 and has tests, no replan needed
    expect(mockedRunStepWithCascade).not.toHaveBeenCalled();
    expect(mockedRunVerifiers).not.toHaveBeenCalled();
  });

  it("TestPhaseRunner_ResumesFromExecution", async () => {
    const { ctx } = createMockPhaseRunnerContext(inMemFs);

    // Pre-populate context and plan checkpoints
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: execute\nTask 2: test testing",
    );

    // Set up mocks for execution onwards
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(passingVerificationReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // Should have called runStepWithCascade for execution
    expect(mockedRunStepWithCascade).toHaveBeenCalled();

    // runStep should NOT have been called for context or plan (they were checkpointed)
    const runStepCalls = mockedRunStep.mock.calls;
    const contextCalls = runStepCalls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("context"),
    );
    const planCalls = runStepCalls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("plan") && !call[0].includes("replan"),
    );
    expect(contextCalls.length).toBe(0);
    expect(planCalls.length).toBe(0);
  });

  it("TestPhaseRunner_PlanVerificationFails_ReturnsFailure", async () => {
    const { ctx } = createMockPhaseRunnerContext(inMemFs);

    // Pre-populate context
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");

    // runStep for plan creation: write a plan with missing requirements
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      if (name.includes("plan") && !name.includes("replan")) {
        // Plan that does NOT cover PHA-03 (missing)
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02\nTask 1: implement\nTask 2: test testing",
        );
      }
      // Replan also fails to add PHA-03
      if (name.includes("replan")) {
        // Replan writes an updated plan, but still missing PHA-03
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02\nTask 1: implement\nTask 2: test testing",
        );
      }
      return verifiedResult();
    });

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01", "PHA-02", "PHA-03"],
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toContain("Plan verification failed");
      expect(result.reason).toContain("PHA-03");
    }
  });

  it("TestPhaseRunner_ExecutionFailure_ReturnsPartial", async () => {
    const { ctx } = createMockPhaseRunnerContext(inMemFs);

    // Pre-populate context and plan
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: implement\nTask 2: test testing",
    );

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue(verifiedResult());

    // Execution step throws
    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue({
      result: {
        status: "failed" as const,
        costUsd: 1,
        costData: {
          totalCostUsd: 1,
          numTurns: 0,
          usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          modelUsage: {},
          durationMs: 0,
          durationApiMs: 0,
        },
        mayHavePartialWork: true,
        error: "Execution crashed",
      },
      attempts: [],
      totalCostUsd: 1,
    });

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("partial");
    if (result.status === "partial") {
      expect(result.lastError).toContain("Plan execution failed");
      expect(result.completedSubsteps).toContain("context");
      expect(result.completedSubsteps).toContain("plan");
      expect(result.completedSubsteps).toContain("verify-plan");
      expect(result.completedSubsteps).not.toContain("execute");
    }
  });

  it("TestPhaseRunner_StateUpdated_InProgress", async () => {
    const { ctx, stateManager } = createMockPhaseRunnerContext(inMemFs);

    // Make context gathering fail immediately to test state at start
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue({
      status: "failed" as const,
      costUsd: 0,
      costData: {
        totalCostUsd: 0,
        numTurns: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        modelUsage: {},
        durationMs: 0,
        durationApiMs: 0,
      },
      mayHavePartialWork: false,
      error: "Context failed",
    });

    await runPhase(5, ctx);

    // First update call should set status to 'in_progress'
    const firstCall = stateManager.update.mock.calls[0];
    expect(firstCall).toBeDefined();

    // The updater function should produce a state with in_progress
    const updater = firstCall[0] as (s: unknown) => Record<string, unknown>;
    const result = updater(stateManager._state);
    const phases = result.phases as Record<string, { status: string }>;
    expect(phases["5"].status).toBe("in_progress");
  });

  it("TestPhaseRunner_StateUpdated_Completed", async () => {
    const { ctx, stateManager } = createMockPhaseRunnerContext(inMemFs);

    // Pre-populate all checkpoints
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: impl\nTask 2: test testing",
    );
    inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
    inMemFs.files.set(path.join(phaseDir, VERIFICATION_FILE), "# V");
    inMemFs.files.set(path.join(phaseDir, GAPS_FILE), "# G");
    inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# R");

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // Last update call should set status to 'completed'
    const updateCalls = stateManager.update.mock.calls;
    const lastCall = updateCalls[updateCalls.length - 1];
    const updater = lastCall[0] as (s: unknown) => Record<string, unknown>;
    const updatedState = updater(stateManager._state);
    const phases = updatedState.phases as Record<string, { status: string }>;
    expect(phases["5"].status).toBe("completed");
  });
});
