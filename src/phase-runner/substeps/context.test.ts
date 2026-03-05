/**
 * Context Gathering Substep Unit Tests
 *
 * Tests that gatherContext() correctly calls runStep() with the
 * context prompt and verifies CONTEXT.md creation.
 *
 * Requirement: PHA-02
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";
import type { PhaseRunnerContext } from "../types.js";
import { CONTEXT_FILE } from "../types.js";
import type { ForgeConfig } from "../../config/schema.js";
import type { StepRunnerContext } from "../../step-runner/types.js";

// Mock step-runner
vi.mock("../../step-runner/index.js", () => ({
  runStep: vi.fn(),
  runStepWithCascade: vi.fn(),
}));

import { runStep } from "../../step-runner/index.js";
import { gatherContext } from "./context.js";

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

describe("Context Substep", () => {
  let inMemFs: ReturnType<typeof createInMemoryFs>;
  let phaseDir: string;
  let ctx: PhaseRunnerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemFs = createInMemoryFs();
    phaseDir = "/test/phase-5";

    const config = createTestConfig();
    const stateManager = createMockStateManager();
    const costController = createMockCostController();

    // Set up ROADMAP.md in the in-memory fs
    const roadmapPath = path.join(process.cwd(), ".planning", "ROADMAP.md");
    inMemFs.files.set(
      roadmapPath,
      `### Phase 5: Phase Runner\n**Goal**: Execute full phase lifecycle\n`,
    );

    ctx = {
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
  });

  it("TestContext_GatherContext_CallsRunStep", async () => {
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async () => {
      inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");
      return {
        status: "verified" as const,
        costUsd: 0.5,
        costData: {
          totalCostUsd: 0.5,
          numTurns: 5,
          usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          modelUsage: {},
          durationMs: 1000,
          durationApiMs: 800,
        },
        result: "Done",
        structuredOutput: undefined,
        sessionId: "test-session",
      };
    });

    await gatherContext(5, phaseDir, ctx);

    // Verify runStep was called
    expect(mockedRunStep).toHaveBeenCalledTimes(1);

    // Verify the step name includes phase number
    const callArgs = mockedRunStep.mock.calls[0];
    expect(callArgs[0]).toContain("phase-5");
    expect(callArgs[0]).toContain("context");

    // Verify the prompt includes phase number and goal
    const stepOpts = callArgs[1] as { prompt: string };
    expect(stepOpts.prompt).toContain("Phase 5");
  });

  it("TestContext_GatherContext_VerifiesContextFile", async () => {
    const mockedRunStep = vi.mocked(runStep);
    mockedRunStep.mockImplementation(async (_name, opts) => {
      // Simulate: CONTEXT.md does NOT exist yet
      // The verify callback should check for its existence
      const verify = opts.verify;
      const result = await verify();
      // Before writing, the file doesn't exist
      expect(result).toBe(false);

      // Now simulate the agent writing CONTEXT.md
      inMemFs.files.set(path.join(phaseDir, CONTEXT_FILE), "# Context");

      // After writing, verify should pass
      const resultAfter = await verify();
      expect(resultAfter).toBe(true);

      return {
        status: "verified" as const,
        costUsd: 0.5,
        costData: {
          totalCostUsd: 0.5,
          numTurns: 5,
          usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          modelUsage: {},
          durationMs: 1000,
          durationApiMs: 800,
        },
        result: "Done",
        structuredOutput: undefined,
        sessionId: "test-session",
      };
    });

    await gatherContext(5, phaseDir, ctx);

    expect(mockedRunStep).toHaveBeenCalledTimes(1);
  });
});
