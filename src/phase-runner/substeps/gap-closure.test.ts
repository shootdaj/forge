/**
 * Gap Closure Substep Unit Tests
 *
 * Tests root cause diagnosis (structured output), targeted fix execution,
 * max round enforcement, and resolution detection.
 *
 * Requirements: GAP-01, GAP-02, GAP-03
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";
import type { PhaseRunnerContext, GapDiagnosis } from "../types.js";
import { CONTEXT_FILE, PLAN_FILE, GAPS_FILE } from "../types.js";
import type { ForgeConfig } from "../../config/schema.js";
import type { StepRunnerContext } from "../../step-runner/types.js";

// Mock step-runner and verifiers modules
vi.mock("../../step-runner/index.js", () => ({
  runStep: vi.fn(),
  runStepWithCascade: vi.fn(),
}));

vi.mock("../../verifiers/index.js", () => ({
  runVerifiers: vi.fn(),
}));

import { runStep, runStepWithCascade } from "../../step-runner/index.js";
import { runVerifiers } from "../../verifiers/index.js";
import {
  runGapClosure,
  diagnoseFailures,
  executeTargetedFix,
  MAX_GAP_CLOSURE_ROUNDS,
} from "./gap-closure.js";

// -------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------

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

function createInMemoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string | Buffer | URL) => {
      const fp = typeof p === "string" ? p : p.toString();
      const content = files.get(fp);
      if (content === undefined) throw new Error(`ENOENT: ${fp}`);
      return content;
    },
    writeFileSync: (p: string | Buffer | URL, content: string) => {
      const fp = typeof p === "string" ? p : p.toString();
      files.set(fp, content);
    },
    mkdirSync: () => undefined,
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
    phases: {},
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: { totalRequirements: 0, verified: 0, gapHistory: [], roundsCompleted: 0 },
    remainingGaps: [],
    uatResults: { status: "not_started" as const, workflowsTested: 0, workflowsPassed: 0, workflowsFailed: 0 },
    totalBudgetUsed: 0,
  };
  return {
    load: vi.fn().mockReturnValue(state),
    save: vi.fn(),
    update: vi.fn().mockImplementation(async (updater: Function) => {
      const updated = updater(state);
      Object.assign(state, updated);
      return updated;
    }),
    exists: vi.fn().mockReturnValue(true),
    statePath: "/test/forge-state.json",
    initialize: vi.fn().mockReturnValue(state),
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

function makeCtx(inMemFs: ReturnType<typeof createInMemoryFs>): PhaseRunnerContext {
  const config = createTestConfig();
  const stateManager = createMockStateManager();
  const costController = createMockCostController();

  return {
    config,
    stateManager: stateManager as unknown as PhaseRunnerContext["stateManager"],
    stepRunnerContext: {
      config,
      stateManager: stateManager as unknown as StepRunnerContext["stateManager"],
      executeQueryFn: vi.fn(),
    },
    costController: costController as unknown as PhaseRunnerContext["costController"],
    fs: inMemFs as unknown as PhaseRunnerContext["fs"],
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
        errors: ["2 tests failed"],
      },
    ],
    summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
    durationMs: 500,
  };
}

function passingReport() {
  return {
    passed: true,
    results: [
      {
        passed: true,
        verifier: "tests",
        details: ["All passed"],
        errors: [],
      },
    ],
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    durationMs: 300,
  };
}

const sampleDiagnosis: GapDiagnosis = {
  category: "missing_dependency",
  description: "Missing lodash package",
  affectedFiles: ["src/utils.ts"],
  suggestedFix: "Install lodash and update import",
  retestCommand: "npm test",
};

function verifiedResultWithDiagnosis() {
  return {
    status: "verified" as const,
    costUsd: 0.5,
    costData: {
      totalCostUsd: 0.5,
      numTurns: 3,
      usage: { inputTokens: 100, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      modelUsage: {},
      durationMs: 500,
      durationApiMs: 400,
    },
    result: JSON.stringify(sampleDiagnosis),
    structuredOutput: sampleDiagnosis,
    sessionId: "test-session",
  };
}

function verifiedCascadeResult() {
  return {
    result: {
      status: "verified" as const,
      costUsd: 0.5,
      costData: {
        totalCostUsd: 0.5,
        numTurns: 3,
        usage: { inputTokens: 100, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        modelUsage: {},
        durationMs: 500,
        durationApiMs: 400,
      },
      result: "Fix applied",
      structuredOutput: undefined,
      sessionId: "test-session",
    },
    attempts: [],
    totalCostUsd: 0.5,
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("Gap Closure", () => {
  let inMemFs: ReturnType<typeof createInMemoryFs>;
  let phaseDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemFs = createInMemoryFs();
    phaseDir = "/test/phase-5";

    // Set up phase files
    inMemFs.files.set(path.join(phaseDir, PLAN_FILE), "# Plan\nTask 1: impl");
    inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
  });

  it("TestGapClosure_DiagnoseFailures_StructuredOutput", async () => {
    const ctx = makeCtx(inMemFs);
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue(verifiedResultWithDiagnosis());

    const diagnosis = await diagnoseFailures(failingReport(), phaseDir, ctx);

    // Verify runStep was called with outputSchema
    expect(mockedRunStep).toHaveBeenCalledTimes(1);
    const callArgs = mockedRunStep.mock.calls[0];
    const stepOpts = callArgs[1] as { outputSchema?: Record<string, unknown> };
    expect(stepOpts.outputSchema).toBeDefined();
    expect(stepOpts.outputSchema!.type).toBe("object");

    // Verify diagnosis has the expected shape
    expect(diagnosis.category).toBe("missing_dependency");
    expect(diagnosis.description).toContain("lodash");
    expect(diagnosis.affectedFiles).toEqual(["src/utils.ts"]);
  });

  it("TestGapClosure_DiagnoseFailures_CategoryEnum", async () => {
    const validCategories = [
      "wrong_approach",
      "missing_dependency",
      "integration_mismatch",
      "requirement_ambiguity",
      "environment_issue",
    ];

    const ctx = makeCtx(inMemFs);
    const mockedRunStep = vi.mocked(runStep);

    for (const category of validCategories) {
      mockedRunStep.mockResolvedValueOnce({
        status: "verified" as const,
        costUsd: 0.5,
        costData: {
          totalCostUsd: 0.5,
          numTurns: 3,
          usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          modelUsage: {},
          durationMs: 500,
          durationApiMs: 400,
        },
        result: "",
        structuredOutput: {
          category,
          description: `Test for ${category}`,
          affectedFiles: [],
          suggestedFix: "Fix it",
          retestCommand: "npm test",
        },
        sessionId: "test",
      });

      const diagnosis = await diagnoseFailures(failingReport(), phaseDir, ctx);
      expect(diagnosis.category).toBe(category);
    }
  });

  it("TestGapClosure_ExecuteTargetedFix_UsesFixPrompt", async () => {
    const ctx = makeCtx(inMemFs);
    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    await executeTargetedFix(sampleDiagnosis, 5, phaseDir, ctx);

    // Verify runStepWithCascade was called (NOT runStep or runPhase)
    expect(mockedRunStepWithCascade).toHaveBeenCalledTimes(1);

    // Verify the prompt contains diagnosis details
    const callArgs = mockedRunStepWithCascade.mock.calls[0];
    const cascadeOpts = callArgs[1] as { prompt: string; maxRetries?: number };
    expect(cascadeOpts.prompt).toContain("missing_dependency");
    expect(cascadeOpts.prompt).toContain("lodash");
    expect(cascadeOpts.prompt).toContain("src/utils.ts");

    // Verify limited retries for gap closure
    expect(cascadeOpts.maxRetries).toBe(1);
  });

  it("TestGapClosure_MaxTwoRounds", async () => {
    const ctx = makeCtx(inMemFs);

    expect(MAX_GAP_CLOSURE_ROUNDS).toBe(2);

    // Set up mocks: diagnosis succeeds, fix succeeds, but re-verification always fails
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue(verifiedResultWithDiagnosis());

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(failingReport());

    await runGapClosure(5, phaseDir, failingReport(), ctx);

    // Should have called diagnosis exactly 2 times (MAX_GAP_CLOSURE_ROUNDS)
    expect(mockedRunStep).toHaveBeenCalledTimes(2);

    // Should have called fix exactly 2 times
    expect(mockedRunStepWithCascade).toHaveBeenCalledTimes(2);

    // Should have called runVerifiers exactly 2 times (re-verify after each fix)
    expect(mockedRunVerifiers).toHaveBeenCalledTimes(2);

    // GAPS.md should be written with 'unresolved' status
    const gapsContent = inMemFs.files.get(path.join(phaseDir, GAPS_FILE));
    expect(gapsContent).toBeDefined();
    expect(gapsContent).toContain("Gaps remaining after max rounds");
  });

  it("TestGapClosure_ResolvedInFirstRound", async () => {
    const ctx = makeCtx(inMemFs);

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue(verifiedResultWithDiagnosis());

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    // First re-verification passes
    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(passingReport());

    await runGapClosure(5, phaseDir, failingReport(), ctx);

    // Should have called diagnosis only once
    expect(mockedRunStep).toHaveBeenCalledTimes(1);

    // Should have called fix only once
    expect(mockedRunStepWithCascade).toHaveBeenCalledTimes(1);

    // GAPS.md should be written with 'resolved' status
    const gapsContent = inMemFs.files.get(path.join(phaseDir, GAPS_FILE));
    expect(gapsContent).toBeDefined();
    expect(gapsContent).toContain("All gaps resolved");
    expect(gapsContent).toContain("1/2"); // 1 of 2 max rounds
  });

  it("TestGapClosure_OnlyFixExecuted_NotFullPhase", async () => {
    const ctx = makeCtx(inMemFs);

    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockResolvedValue(verifiedResultWithDiagnosis());

    const mockedRunStepWithCascade = vi.mocked(runStepWithCascade);
    mockedRunStepWithCascade.mockResolvedValue(verifiedCascadeResult());

    const mockedRunVerifiers = vi.mocked(runVerifiers);
    mockedRunVerifiers.mockResolvedValue(passingReport());

    await runGapClosure(5, phaseDir, failingReport(), ctx);

    // Verify that the fix was executed via runStepWithCascade (targeted fix)
    // NOT via runPhase (full phase re-execution) -- GAP-03
    expect(mockedRunStepWithCascade).toHaveBeenCalledTimes(1);

    // The step name should indicate it's a gap fix, not a full execution
    const callArgs = mockedRunStepWithCascade.mock.calls[0];
    expect(callArgs[0]).toContain("gap-fix");
    expect(callArgs[0]).not.toContain("execute");
  });
});
