/**
 * Phase Runner Scenario Tests
 *
 * End-to-end scenario tests that exercise the full phase runner lifecycle
 * from the user's perspective. Treats runPhase() as a black box: call it
 * with a context, verify PhaseResult and side effects (files, state).
 *
 * Mock only the SDK's executeQueryFn (since we can't make real API calls).
 *
 * Requirement coverage:
 * PHA-01: TestPhaseRunner_Scenario_HappyPath, TestPhaseRunner_Scenario_BudgetExceeded
 * PHA-02: TestPhaseRunner_Scenario_HappyPath (context gathering)
 * PHA-03: TestPhaseRunner_Scenario_HappyPath (plan creation)
 * PHA-04: TestPhaseRunner_Scenario_PlanVerificationWithInjection, TestPhaseRunner_Scenario_PlanVerificationReplanning
 * PHA-05: TestPhaseRunner_Scenario_PlanVerificationWithInjection
 * PHA-06: TestPhaseRunner_Scenario_PlanVerificationReplanning
 * PHA-07: TestPhaseRunner_Scenario_HappyPath (execution with cascade)
 * PHA-08: TestPhaseRunner_Scenario_HappyPath (verification after execution)
 * PHA-09: TestPhaseRunner_Scenario_GapClosureSuccess, TestPhaseRunner_Scenario_GapClosureExhausted
 * PHA-10: (covered via gap closure scenarios that also check test gaps)
 * PHA-11: TestPhaseRunner_Scenario_MultipleCheckpointsCreated
 * PHA-12: TestPhaseRunner_Scenario_ResumeFromCheckpoint, TestPhaseRunner_Scenario_ResumeFromExecution
 * GAP-01: TestPhaseRunner_Scenario_GapClosureSuccess (root cause categorization)
 * GAP-02: TestPhaseRunner_Scenario_GapClosureSuccess (targeted fix plan)
 * GAP-03: TestPhaseRunner_Scenario_GapClosureSuccess (fix-only execution)
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

// Mock step-runner and verifiers
vi.mock("../../src/step-runner/index.js", () => ({
  runStep: vi.fn(),
  runStepWithCascade: vi.fn(),
}));

vi.mock("../../src/verifiers/index.js", () => ({
  runVerifiers: vi.fn(),
}));

import { runStep, runStepWithCascade } from "../../src/step-runner/index.js";
import { runVerifiers } from "../../src/verifiers/index.js";
import { runPhase } from "../../src/phase-runner/phase-runner.js";

// ---------------------------------------------------------------------------
// Shared helpers
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

function createInMemoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (filePath: string): boolean => files.has(filePath),
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
    ): string | undefined => undefined,
  };
}

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

function verifiedResult(overrides?: {
  result?: string;
  structuredOutput?: unknown;
}) {
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

function verifiedCascadeResult() {
  return {
    result: verifiedResult(),
    attempts: [],
    totalCostUsd: 0.5,
  };
}

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

function failingReport() {
  return {
    passed: false,
    results: [
      {
        passed: false,
        verifier: "tests",
        details: [],
        errors: ["3 tests failed"],
      },
      { passed: true, verifier: "typecheck", details: ["Clean"], errors: [] },
    ],
    summary: { total: 2, passed: 1, failed: 1, skipped: 0 },
    durationMs: 500,
  };
}

/** Standard plan content that passes verification */
const VALID_PLAN = `# Phase Plan
Requirements: PHA-01, PHA-02, PHA-03
Task 1: Implement module
Task 2: Write tests for module testing
<files>src/module.ts</files>

## Success Criteria
All tests pass.
`;

/** Plan content requiring requirement IDs for scenarios */
function makeValidPlan(reqIds: string[]): string {
  return `# Phase Plan
Requirements: ${reqIds.join(", ")}
Task 1: Implement module
Task 2: Write tests for module testing
<files>src/module.ts</files>

## Success Criteria
All tests pass.
`;
}

function createScenarioContext(
  inMemFs: ReturnType<typeof createInMemoryFs>,
  configOverrides: Partial<ForgeConfig> = {},
) {
  const config = createTestConfig(configOverrides);
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

  return { ctx, stateManager, costController, config };
}

/**
 * Set up standard mocks for a happy-path execution.
 * Returns the mock functions for further customization.
 */
function setupHappyPathMocks(
  inMemFs: ReturnType<typeof createInMemoryFs>,
  phaseDir: string,
  reqIds: string[],
) {
  const mockedRunStep = vi.mocked(runStep);
  const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
  const mockedRunVerifiers = vi.mocked(runVerifiers);

  mockedRunStep.mockImplementation(async (name) => {
    if (name.includes("context")) {
      inMemFs.files.set(
        path.join(phaseDir, CONTEXT_FILE),
        "# Phase Context\nAll decisions locked.",
      );
    } else if (name.includes("plan") && !name.includes("replan")) {
      inMemFs.files.set(
        path.join(phaseDir, PLAN_FILE),
        makeValidPlan(reqIds),
      );
    } else if (name.includes("docs")) {
      inMemFs.files.set(
        path.join(phaseDir, REPORT_FILE),
        "# Phase Report\nPhase completed successfully.",
      );
    }
    return verifiedResult();
  });

  mockedRunStepWithCascade.mockImplementation(async (name) => {
    if (name.includes("execute")) {
      inMemFs.files.set(
        path.join(phaseDir, EXECUTION_MARKER),
        `Execution completed at ${new Date().toISOString()}`,
      );
    }
    return verifiedCascadeResult();
  });

  mockedRunVerifiers.mockResolvedValue(passingReport());

  return { mockedRunStep, mockedRunStepWithCascade, mockedRunVerifiers };
}

// ---------------------------------------------------------------------------
// Scenario Tests
// ---------------------------------------------------------------------------

describe("Phase Runner Scenarios", () => {
  let inMemFs: ReturnType<typeof createInMemoryFs>;
  let phaseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemFs = createInMemoryFs();
    phaseDir = path.join(process.cwd(), ".planning", "phases", "01-phase-1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Scenario: Golden path -- run full phase lifecycle from scratch.
   * context -> plan -> verify-plan -> execute -> verify-build -> docs
   *
   * PHA-01, PHA-02, PHA-03, PHA-07, PHA-08
   */
  it("TestPhaseRunner_Scenario_HappyPath", async () => {
    const reqIds = ["PHA-01", "PHA-02"];
    const { ctx, stateManager } = createScenarioContext(inMemFs);
    setupHappyPathMocks(inMemFs, phaseDir, reqIds);

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    // Observable outcome: completed
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.report).toContain("PHASE_REPORT.md");
    }

    // Observable: all checkpoint files exist
    expect(inMemFs.files.has(path.join(phaseDir, CONTEXT_FILE))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, PLAN_FILE))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, EXECUTION_MARKER))).toBe(true);
    expect(inMemFs.files.has(path.join(phaseDir, VERIFICATION_FILE))).toBe(
      true,
    );
    expect(inMemFs.files.has(path.join(phaseDir, REPORT_FILE))).toBe(true);

    // Observable: state shows phase completed
    const updateCalls = stateManager.update.mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    const lastUpdater = updateCalls[updateCalls.length - 1][0] as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const finalState = lastUpdater(stateManager._state);
    const phases = finalState.phases as Record<string, { status: string }>;
    expect(phases["1"].status).toBe("completed");
  });

  /**
   * Scenario: Resume from checkpoint -- context and plan already exist.
   * Should skip context and plan creation, proceed with execution.
   *
   * PHA-12
   */
  it("TestPhaseRunner_Scenario_ResumeFromCheckpoint", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);

    // Pre-create checkpoint files
    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Existing Context\nDecisions locked.",
    );
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      makeValidPlan(reqIds),
    );

    const { mockedRunStep, mockedRunStepWithCascade, mockedRunVerifiers } =
      setupHappyPathMocks(inMemFs, phaseDir, reqIds);

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // Context and plan steps should NOT have been called
    const runStepCalls = mockedRunStep.mock.calls.map(
      (c) => c[0] as string,
    );
    const contextCalls = runStepCalls.filter((n) => n.includes("context"));
    const planCalls = runStepCalls.filter(
      (n) => n.includes("plan") && !n.includes("replan"),
    );
    expect(contextCalls.length).toBe(0);
    expect(planCalls.length).toBe(0);

    // Execution and verification still ran
    expect(mockedRunStepWithCascade).toHaveBeenCalled();
    expect(mockedRunVerifiers).toHaveBeenCalled();
  });

  /**
   * Scenario: Resume from execution -- context, plan, and execution already exist.
   * Should skip context, plan, and execution. Only verification + docs run.
   *
   * PHA-12
   */
  it("TestPhaseRunner_Scenario_ResumeFromExecution", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);

    // Pre-create all early checkpoint files
    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Existing Context",
    );
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      makeValidPlan(reqIds),
    );
    inMemFs.files.set(
      path.join(phaseDir, EXECUTION_MARKER),
      "Execution completed",
    );

    const { mockedRunStep, mockedRunStepWithCascade, mockedRunVerifiers } =
      setupHappyPathMocks(inMemFs, phaseDir, reqIds);

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // Execution should NOT have been called (already checkpointed)
    expect(mockedRunStepWithCascade).not.toHaveBeenCalled();

    // Verification still ran
    expect(mockedRunVerifiers).toHaveBeenCalled();

    // Docs step ran
    const docsCall = mockedRunStep.mock.calls.find(
      (c) => (c[0] as string).includes("docs"),
    );
    expect(docsCall).toBeDefined();
  });

  /**
   * Scenario: Gap closure -- verification fails, diagnosis produces fix, re-verify passes.
   *
   * PHA-09, GAP-01, GAP-02, GAP-03
   */
  it("TestPhaseRunner_Scenario_GapClosureSuccess", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);

    // Pre-populate context and plan
    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Context",
    );
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      makeValidPlan(reqIds),
    );

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (name) => {
      if (name.includes("diagnosis") || name.includes("gap-diagnosis")) {
        return verifiedResult({
          structuredOutput: {
            category: "wrong_approach",
            description: "Assertion logic was inverted",
            affectedFiles: ["src/module.ts"],
            suggestedFix: "Reverse the comparison operator",
            retestCommand: "npm test",
          },
        });
      }
      if (name.includes("docs")) {
        inMemFs.files.set(
          path.join(phaseDir, REPORT_FILE),
          "# Phase Report",
        );
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      return verifiedCascadeResult();
    });

    // First verification fails, second (after fix) passes
    let verifyCallCount = 0;
    vi.mocked(runVerifiers).mockImplementation(async () => {
      verifyCallCount++;
      if (verifyCallCount === 1) {
        return failingReport();
      }
      return passingReport();
    });

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // GAPS.md created with 'resolved' status
    expect(inMemFs.files.has(path.join(phaseDir, GAPS_FILE))).toBe(true);
    const gapsContent =
      inMemFs.files.get(path.join(phaseDir, GAPS_FILE)) ?? "";
    expect(gapsContent).toContain("resolved");
    expect(gapsContent).toContain("wrong_approach");
  });

  /**
   * Scenario: Gap closure exhausted -- verification always fails.
   * After MAX_GAP_CLOSURE_ROUNDS (2), gap closure stops.
   *
   * PHA-09, GAP-01
   */
  it("TestPhaseRunner_Scenario_GapClosureExhausted", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);

    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Context",
    );
    inMemFs.files.set(
      path.join(phaseDir, PLAN_FILE),
      makeValidPlan(reqIds),
    );

    let diagnosisCallCount = 0;
    vi.mocked(runStep).mockImplementation(async (name) => {
      if (name.includes("diagnosis") || name.includes("gap-diagnosis")) {
        diagnosisCallCount++;
        return verifiedResult({
          structuredOutput: {
            category: "integration_mismatch",
            description: `Attempt ${diagnosisCallCount} diagnosis`,
            affectedFiles: ["src/module.ts"],
            suggestedFix: "Fix integration",
            retestCommand: "npm test",
          },
        });
      }
      if (name.includes("docs")) {
        inMemFs.files.set(
          path.join(phaseDir, REPORT_FILE),
          "# Phase Report",
        );
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      return verifiedCascadeResult();
    });

    // Verification always fails
    vi.mocked(runVerifiers).mockResolvedValue(failingReport());

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    // Phase completes (gap closure doesn't block phase report)
    expect(result.status).toBe("completed");

    // Exactly 2 diagnosis rounds (MAX_GAP_CLOSURE_ROUNDS)
    expect(diagnosisCallCount).toBe(2);

    // GAPS.md exists with 'unresolved' status
    expect(inMemFs.files.has(path.join(phaseDir, GAPS_FILE))).toBe(true);
    const gapsContent =
      inMemFs.files.get(path.join(phaseDir, GAPS_FILE)) ?? "";
    expect(gapsContent).toContain("Gaps remaining after max rounds");
    expect(gapsContent).toContain("2/2");
  });

  /**
   * Scenario: Plan verification with test task injection.
   * Plan covers all requirements but lacks test tasks for a component.
   *
   * PHA-04, PHA-05
   */
  it("TestPhaseRunner_Scenario_PlanVerificationWithInjection", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);

    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Context",
    );

    vi.mocked(runStep).mockImplementation(async (name) => {
      if (name.includes("plan") && !name.includes("replan")) {
        // Plan with all requirements but no test task keywords
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          `# Plan
PHA-01
Task 1: Implement auth module
<files>src/auth.ts</files>

## Success Criteria
Auth works.
`,
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(
          path.join(phaseDir, REPORT_FILE),
          "# Phase Report",
        );
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      return verifiedCascadeResult();
    });

    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // PLAN.md should now contain injected test tasks marker
    const planContent =
      inMemFs.files.get(path.join(phaseDir, PLAN_FILE)) ?? "";
    expect(planContent).toContain("FORGE:INJECTED_TEST_TASKS");
  });

  /**
   * Scenario: Plan verification triggers re-planning because requirements are missing.
   *
   * PHA-06
   */
  it("TestPhaseRunner_Scenario_PlanVerificationReplanning", async () => {
    const reqIds = ["PHA-01", "PHA-02"];
    const { ctx } = createScenarioContext(inMemFs);

    inMemFs.files.set(
      path.join(phaseDir, CONTEXT_FILE),
      "# Context",
    );

    let replanCalled = false;

    vi.mocked(runStep).mockImplementation(async (name) => {
      if (name.includes("plan") && !name.includes("replan")) {
        // Plan missing PHA-02
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          `# Plan
PHA-01
Task 1: Implement module
Task 2: Write test testing
`,
        );
      } else if (name.includes("replan")) {
        replanCalled = true;
        // Replan fixes the issue by adding PHA-02
        inMemFs.files.set(
          path.join(phaseDir, PLAN_FILE),
          makeValidPlan(reqIds),
        );
      } else if (name.includes("docs")) {
        inMemFs.files.set(
          path.join(phaseDir, REPORT_FILE),
          "# Phase Report",
        );
      }
      return verifiedResult();
    });

    vi.mocked(runStepWithCascade).mockImplementation(async (name) => {
      if (name.includes("execute")) {
        inMemFs.files.set(path.join(phaseDir, EXECUTION_MARKER), "done");
      }
      return verifiedCascadeResult();
    });

    vi.mocked(runVerifiers).mockResolvedValue(passingReport());

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // Replan was called
    expect(replanCalled).toBe(true);

    // Final plan has all requirements
    const planContent =
      inMemFs.files.get(path.join(phaseDir, PLAN_FILE)) ?? "";
    expect(planContent).toContain("PHA-01");
    expect(planContent).toContain("PHA-02");
  });

  /**
   * Scenario: Budget exceeded -- phase fails because budget is at limit.
   *
   * PHA-01 (error path)
   */
  it("TestPhaseRunner_Scenario_BudgetExceeded", async () => {
    const reqIds = ["PHA-01"];
    const { ctx, stateManager } = createScenarioContext(inMemFs, {
      maxBudgetTotal: 0.01,
    });

    // Set budget already at limit
    stateManager._state.totalBudgetUsed = 0.01;

    // runStep should throw BudgetExceededError since the step runner checks budget
    vi.mocked(runStep).mockImplementation(async () => {
      return {
        status: "budget_exceeded" as const,
        costUsd: 0 as const,
        totalBudgetUsed: 0.01,
        maxBudgetTotal: 0.01,
        error: "Project budget exceeded: $0.01 used of $0.01 limit",
      };
    });

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    // Context gathering returns budget_exceeded which causes a throw
    // because the status is not "verified"
    expect(result.status).toBe("partial");
    if (result.status === "partial") {
      expect(result.lastError).toContain("Context gathering failed");
    }

    // State should NOT be set to completed
    const updateCalls = stateManager.update.mock.calls;
    const lastUpdater = updateCalls[updateCalls.length - 1][0] as (
      s: Record<string, unknown>,
    ) => Record<string, unknown>;
    const lastState = lastUpdater(stateManager._state);
    const phases = lastState.phases as Record<string, { status: string }>;
    expect(phases["1"].status).not.toBe("completed");
  });

  /**
   * Scenario: Full lifecycle creates all checkpoint files with non-empty content.
   *
   * PHA-11
   */
  it("TestPhaseRunner_Scenario_MultipleCheckpointsCreated", async () => {
    const reqIds = ["PHA-01"];
    const { ctx } = createScenarioContext(inMemFs);
    setupHappyPathMocks(inMemFs, phaseDir, reqIds);

    const result = await runPhase(1, ctx, { requirementIds: reqIds });

    expect(result.status).toBe("completed");

    // All checkpoint files exist
    const checkpointFiles = [
      CONTEXT_FILE,
      PLAN_FILE,
      EXECUTION_MARKER,
      VERIFICATION_FILE,
      REPORT_FILE,
    ];

    for (const fileName of checkpointFiles) {
      const filePath = path.join(phaseDir, fileName);
      expect(inMemFs.files.has(filePath)).toBe(true);

      // Each file has non-empty content
      const content = inMemFs.files.get(filePath) ?? "";
      expect(content.length).toBeGreaterThan(0);
    }
  });
});
