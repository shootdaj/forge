/**
 * Phase Runner Integration Tests
 *
 * Tests that verify component interactions between phase runner substeps,
 * StateManager, CostController, checkpoint system, and plan verification.
 * Uses mocked SDK query() but real implementations of internal components.
 *
 * Requirements tested: PHA-01, PHA-02, PHA-03, PHA-04, PHA-05, PHA-06,
 *                      PHA-07, PHA-08, PHA-09, PHA-10, PHA-11, PHA-12,
 *                      GAP-01, GAP-02, GAP-03
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import type { PhaseRunnerContext } from "../../src/phase-runner/types.js";
import {
  CONTEXT_FILE,
  PLAN_FILE,
  EXECUTION_MARKER,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
} from "../../src/phase-runner/types.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import type { StepRunnerContext } from "../../src/step-runner/types.js";

// Mock step-runner and verifiers at module level
vi.mock("../../src/step-runner/index.js", () => ({
  runStep: vi.fn(),
  runStepWithCascade: vi.fn(),
}));

vi.mock("../../src/verifiers/index.js", () => ({
  runVerifiers: vi.fn(),
}));

// Import mocked modules
import { runStep, runStepWithCascade } from "../../src/step-runner/index.js";
import { runVerifiers } from "../../src/verifiers/index.js";
import { runPhase } from "../../src/phase-runner/phase-runner.js";
import {
  detectCheckpoints,
  writeCheckpoint,
  getCompletedSubsteps,
} from "../../src/phase-runner/checkpoint.js";
import {
  verifyPlanCoverage,
  injectTestTasks,
} from "../../src/phase-runner/plan-verification.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
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
    ...overrides,
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
    readFileSync: (
      filePath: string | Buffer | URL,
      _encoding?: string,
    ): string => {
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
    mkdirSync: (
      _dirPath: string | Buffer | URL,
      _opts?: unknown,
    ): string | undefined => {
      return undefined;
    },
  };
}

/** Mock StateManager with real-ish behavior */
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
    update: vi
      .fn()
      .mockImplementation(
        async (updater: (s: typeof state) => typeof state) => {
          const updated = updater(state);
          Object.assign(state, updated);
          return updated;
        },
      ),
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

/** Verified step result */
function verifiedResult(overrides?: Partial<{ result: string; structuredOutput: unknown }>) {
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
    result: overrides?.result ?? "Done",
    structuredOutput: overrides?.structuredOutput ?? undefined,
    sessionId: "test-session",
  };
}

/** Verified cascade result */
function verifiedCascadeResult() {
  return {
    result: verifiedResult(),
    attempts: [],
    totalCostUsd: 0.5,
  };
}

/** Passing verification report */
function passingReport() {
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
function failingReport(opts?: { hasCoverageFailure?: boolean }) {
  const results = [
    {
      passed: false,
      verifier: "tests",
      details: [],
      errors: ["2 tests failed"],
    },
    {
      passed: true,
      verifier: "typecheck",
      details: ["Clean"],
      errors: [],
    },
  ];
  if (opts?.hasCoverageFailure) {
    results.push({
      passed: false,
      verifier: "coverage",
      details: [],
      errors: ["Coverage below threshold"],
    });
  }
  return {
    passed: false,
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      skipped: 0,
    },
    durationMs: 500,
  };
}

/** Create full PhaseRunnerContext with in-memory fs */
function createIntegrationContext(inMemFs: ReturnType<typeof createInMemoryFs>) {
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
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
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
    costController:
      costController as unknown as PhaseRunnerContext["costController"],
    fs: inMemFs as unknown as PhaseRunnerContext["fs"],
  };

  return { ctx, stateManager, costController, config, stepRunnerContext };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("Phase Runner Integration", () => {
  let inMemFs: ReturnType<typeof createInMemoryFs>;
  let phaseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemFs = createInMemoryFs();
    phaseDir = path.join(process.cwd(), ".planning", "phases", "05-phase-5");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * PHA-02, PHA-03: Context gathering writes CONTEXT.md, then plan
   * creation reads it and writes PLAN.md. Verifies the handoff.
   */
  it("TestPhaseRunner_Integration_ContextToPlan", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    const callOrder: string[] = [];

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      callOrder.push(name);
      if (name.includes("context")) {
        inMemFs.files.set(
          path.join(phaseDir, CONTEXT_FILE),
          "# Phase 5 Context\n\nDecisions locked.",
        );
      } else if (name.includes("plan") && !name.includes("replan")) {
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02\nTask 1: implement\nTask 2: write tests testing",
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockResolvedValue(verifiedCascadeResult());
    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01", "PHA-02"],
    });

    expect(result.status).toBe("completed");

    // Context called before plan
    const contextIdx = callOrder.findIndex((n) => n.includes("context"));
    const planIdx = callOrder.findIndex(
      (n) => n.includes("plan") && !n.includes("replan"),
    );
    expect(contextIdx).toBeGreaterThanOrEqual(0);
    expect(planIdx).toBeGreaterThan(contextIdx);

    // Both checkpoint files exist
    expect(inMemFs.files.has(path.join(phaseDir, CONTEXT_FILE))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, PLAN_FILE))).toBe(true);
  });

  /**
   * PHA-04, PHA-05, PHA-06: Plan verification detects missing requirements,
   * injects test tasks if needed, and triggers re-planning.
   */
  it("TestPhaseRunner_Integration_PlanVerificationGates", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    const callOrder: string[] = [];

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      callOrder.push(name);
      if (name.includes("context")) {
        inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
      } else if (name.includes("plan") && !name.includes("replan")) {
        // Plan missing PHA-03
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02\nTask 1: build\nTask 2: test testing",
        );
      } else if (name.includes("replan")) {
        // Replan adds PHA-03
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01 PHA-02 PHA-03\nTask 1: build\nTask 2: implement PHA-03\nTask 3: test testing",
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockResolvedValue(verifiedCascadeResult());
    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01", "PHA-02", "PHA-03"],
    });

    expect(result.status).toBe("completed");

    // Replan step was called because initial plan was missing PHA-03
    const replanCalls = callOrder.filter((n) => n.includes("replan"));
    expect(replanCalls.length).toBeGreaterThanOrEqual(1);

    // Final plan should contain PHA-03
    const finalPlan = inMemFs.files.get(path.join(phaseDir, PLAN_FILE)) ?? "";
    expect(finalPlan).toContain("PHA-03");
  });

  /**
   * PHA-07: Execution uses runStepWithCascade and writes EXECUTION_MARKER.
   */
  it("TestPhaseRunner_Integration_ExecutionWithCascade", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    // Pre-populate context and plan
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: build it\nTask 2: test testing",
    );

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockImplementation(async () => {
      // Simulate execution writing the marker
      inMemFs.files.set(
        path.join(phaseDir, EXECUTION_MARKER),
        `Execution completed at ${new Date().toISOString()}`,
      );
      return verifiedCascadeResult();
    });

    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // runStepWithCascade was called (not bare runStep for execution)
    expect(mockedRunStepWithCascade).toHaveBeenCalled();
    const cascadeCallName = mockedRunStepWithCascade.mock.calls[0][0];
    expect(cascadeCallName).toContain("execute");

    // EXECUTION_MARKER written
    expect(inMemFs.files.has(path.join(phaseDir, EXECUTION_MARKER))).toBe(true);
  });

  /**
   * PHA-08: Verification calls runVerifiers and writes VERIFICATION.md.
   */
  it("TestPhaseRunner_Integration_VerificationCallsVerifiers", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    // Pre-populate up to execution
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: build\nTask 2: test testing",
    );

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async () => {
      inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      return verifiedCascadeResult();
    });

    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(passingReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // runVerifiers was called
    expect(mockedRunVerifiers).toHaveBeenCalledTimes(1);
    const verifierConfig = mockedRunVerifiers.mock.calls[0][0];
    expect(verifierConfig).toHaveProperty("forgeConfig");

    // VERIFICATION.md written (by verifyBuild substep)
    expect(inMemFs.files.has(path.join(phaseDir, VERIFICATION_FILE))).toBe(
      true,
    );
    const verContent =
      inMemFs.files.get(path.join(phaseDir, VERIFICATION_FILE)) ?? "";
    expect(verContent.length).toBeGreaterThan(0);
  });

  /**
   * PHA-09, GAP-01, GAP-02, GAP-03: Gap closure diagnoses failures,
   * applies targeted fix, and re-verifies.
   */
  it("TestPhaseRunner_Integration_GapClosureFlow", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    // Pre-populate up to execution
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: build\nTask 2: test testing",
    );

    const mockedRunStep = vi.mocked(runStep);
    const diagnosisStepCalls: string[] = [];

    mockedRunStep.mockImplementation(async (name, opts) => {
      if (name.includes("diagnosis") || name.includes("gap-diagnosis")) {
        diagnosisStepCalls.push(name);
        // Return structured GapDiagnosis
        return verifiedResult({
          structuredOutput: {
            category: "wrong_approach",
            description: "Test assertion was incorrect",
            affectedFiles: ["src/module.ts"],
            suggestedFix: "Fix the assertion logic",
            retestCommand: "npm test",
          },
        });
      }
      if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    let cascadeCallCount = 0;
    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      cascadeCallCount++;
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      // Gap fix steps use cascade too
      return verifiedCascadeResult();
    });

    // First verification fails, second (after fix) passes
    let verifierCallCount = 0;
    vi.mocked(runVerifiers).mockImplementation(async () => {
      verifierCallCount++;
      if (verifierCallCount === 1) {
        return failingReport();
      }
      return passingReport();
    });

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // Diagnosis step was called with structured output
    expect(diagnosisStepCalls.length).toBeGreaterThanOrEqual(1);

    // GAPS.md written with resolution
    expect(inMemFs.files.has(path.join(phaseDir, GAPS_FILE))).toBe(true);
    const gapsContent =
      inMemFs.files.get(path.join(phaseDir, GAPS_FILE)) ?? "";
    expect(gapsContent).toContain("resolved");
  });

  /**
   * PHA-01: State updated to in_progress at start and completed at end.
   */
  it("TestPhaseRunner_Integration_StateUpdates", async () => {
    const { ctx, stateManager } = createIntegrationContext(inMemFs);

    // All checkpoints pre-populated for fast completion
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\nTask 1: build\nTask 2: test testing",
    );
    inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
    inMemFs.files.set(path.join(phaseDir, VERIFICATION_FILE), "# V");
    inMemFs.files.set(path.join(phaseDir, GAPS_FILE), "# G");
    inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# R");

    await runPhase(5, ctx, { requirementIds: ["PHA-01"] });

    // state.update was called
    expect(stateManager.update).toHaveBeenCalled();

    // First call: in_progress
    const firstUpdater = stateManager.update.mock.calls[0][0] as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const firstResult = firstUpdater(stateManager._state);
    const firstPhases = firstResult.phases as Record<
      string,
      { status: string }
    >;
    expect(firstPhases["5"].status).toBe("in_progress");

    // Last call: completed
    const lastCall =
      stateManager.update.mock.calls[
        stateManager.update.mock.calls.length - 1
      ];
    const lastUpdater = lastCall[0] as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const lastResult = lastUpdater(stateManager._state);
    const lastPhases = lastResult.phases as Record<
      string,
      { status: string; startedAt?: string; completedAt?: string }
    >;
    expect(lastPhases["5"].status).toBe("completed");
    expect(lastPhases["5"].completedAt).toBeDefined();
  });

  /**
   * PHA-10: Test gap filling is triggered when coverage verifier reports failure.
   */
  it("TestPhaseRunner_Integration_TestGapFilling", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      "# Plan\nPHA-01\n<files>src/module.ts</files>\nTask 1: build module\nTask 2: test testing",
    );

    const testGapCalls: string[] = [];
    vi.mocked(runStep).mockImplementation(async (name) => {
      if (name.includes("test-gap")) {
        testGapCalls.push(name);
      }
      if (name.includes("docs")) {
        inMemFs.files.set(path.join(phaseDir, REPORT_FILE), "# Report");
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      return verifiedCascadeResult();
    });

    // First verification: coverage failure triggers test gap filling
    // Second verification (in gap closure): passes
    let verifyCount = 0;
    vi.mocked(runVerifiers).mockImplementation(async () => {
      verifyCount++;
      if (verifyCount === 1) {
        return failingReport({ hasCoverageFailure: true });
      }
      return passingReport();
    });

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // Test gap filling step was called
    expect(testGapCalls.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * PHA-11: All checkpoint files created during full phase execution.
   */
  it("TestPhaseRunner_Integration_CheckpointWriting", async () => {
    const { ctx } = createIntegrationContext(inMemFs);

    vi.mocked(runStep).mockImplementation(async (name) => {
      if (name.includes("context")) {
        inMemFs.files.set(
          path.join(phaseDir, CONTEXT_FILE),
          "# Context content",
        );
      } else if (name.includes("plan") && !name.includes("replan")) {
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          "# Plan\nPHA-01\nTask 1: build\nTask 2: test testing",
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(
          path.join(phaseDir, REPORT_FILE),
          "# Phase Report content",
        );
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async () => {
      inMemFs.files.set(
        path.join(phaseDir, EXECUTION_MARKER),
        "Execution completed",
      );
      return verifiedCascadeResult();
    });

    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(5, ctx, {
      requirementIds: ["PHA-01"],
    });

    expect(result.status).toBe("completed");

    // All checkpoint files exist
    expect(inMemFs.files.has(path.join(phaseDir, CONTEXT_FILE))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, PLAN_FILE))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, VERIFICATION_FILE))).toBe(
      true,
    );
    expect(inMemFs.files.has(path.join(phaseDir, REPORT_FILE))).toBe(true);

    // Verify non-empty content
    for (const file of [CONTEXT_FILE, PLAN_FILE, VERIFICATION_FILE, REPORT_FILE]) {
      const content = inMemFs.files.get(path.join(phaseDir, file)) ?? "";
      expect(content.length).toBeGreaterThan(0);
    }
  });

  /**
   * Supplementary: Verify plan verification as a pure function integration.
   * PHA-04, PHA-05 direct verification using real plan-verification module.
   */
  it("TestPhaseRunner_Integration_PlanVerificationPureFunctions", () => {
    // Test verifyPlanCoverage with real implementation
    const planContent = `# Phase Plan
## Task 1: Implement auth (PHA-01, PHA-02)
<files>src/auth.ts</files>
## Task 2: Implement API (PHA-03)
<files>src/api.ts</files>
`;

    const result = verifyPlanCoverage(planContent, [
      "PHA-01",
      "PHA-02",
      "PHA-03",
      "PHA-04",
    ]);

    // PHA-04 should be missing
    expect(result.missingRequirements).toContain("PHA-04");
    expect(result.coveredRequirements).toContain("PHA-01");
    expect(result.coveredRequirements).toContain("PHA-02");
    expect(result.coveredRequirements).toContain("PHA-03");
    expect(result.passed).toBe(false);

    // Test task injection
    const injected = injectTestTasks(planContent, ["auth", "api"]);
    expect(injected).toContain("FORGE:INJECTED_TEST_TASKS");
    expect(injected).toContain("Write tests for auth");
    expect(injected).toContain("Write tests for api");
  });

  /**
   * Supplementary: Checkpoint detection and writing integration.
   * PHA-11, PHA-12 using real checkpoint module with in-memory fs.
   */
  it("TestPhaseRunner_Integration_CheckpointDetectionAndResume", () => {
    const testDir = "/tmp/test-phase";

    // Write checkpoints
    const fsImpl = {
      mkdirSync: inMemFs.mkdirSync,
      writeFileSync: inMemFs.writeFileSync,
    };
    writeCheckpoint(testDir, CONTEXT_FILE, "# Context", fsImpl);
    writeCheckpoint(testDir, PLAN_FILE, "# Plan", fsImpl);

    // Detect checkpoints
    const checkpoints = detectCheckpoints(testDir, {
      existsSync: inMemFs.existsSync,
    });

    expect(checkpoints.contextDone).toBe(true);
    expect(checkpoints.planDone).toBe(true);
    expect(checkpoints.executionDone).toBe(false);
    expect(checkpoints.verificationDone).toBe(false);
    expect(checkpoints.gapsDone).toBe(false);
    expect(checkpoints.reportDone).toBe(false);

    // Get completed substeps
    const completed = getCompletedSubsteps(checkpoints);
    expect(completed).toContain("context");
    expect(completed).toContain("plan");
    expect(completed).toContain("verify-plan"); // implicit from planDone
    expect(completed).not.toContain("execute");
    expect(completed).not.toContain("verify-build");
    expect(completed).not.toContain("docs");
  });
});
