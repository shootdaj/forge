/**
 * CLI Entry Point Unit Tests
 *
 * Tests command wiring and handler behavior using vitest mocking.
 * All heavy dependencies (pipeline, phase-runner, config, state) are mocked.
 *
 * Requirements: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ForgeState } from "../state/schema.js";
import type { ForgeConfig } from "../config/schema.js";
import type { PipelineResult } from "../pipeline/types.js";
import type { PhaseResult } from "../phase-runner/types.js";

// ---------------------------------------------------------------------------
// Mock all external modules
// ---------------------------------------------------------------------------

const mockLoadConfig = vi.fn();
const mockLoadConfigOrDefaults = vi.fn();

vi.mock("../config/index.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  loadConfigOrDefaults: (...args: unknown[]) => mockLoadConfigOrDefaults(...args),
}));

const mockStateManager = {
  exists: vi.fn(() => true),
  load: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  statePath: "/test/forge-state.json",
};

const mockCreateInitialState = vi.fn();

// StateManager is used with `new`, so the mock must be a class
class MockStateManagerClass {
  exists = mockStateManager.exists;
  load = mockStateManager.load;
  save = mockStateManager.save;
  update = mockStateManager.update;
  statePath = mockStateManager.statePath;
}

vi.mock("../state/index.js", () => ({
  StateManager: MockStateManagerClass,
  createInitialState: (...args: unknown[]) => mockCreateInitialState(...args),
  STATE_FILE_NAME: "forge-state.json",
}));

const mockRunPipeline = vi.fn();
const mockLoadResumeData = vi.fn();

vi.mock("../pipeline/index.js", () => ({
  runPipeline: (...args: unknown[]) => mockRunPipeline(...args),
  loadResumeData: (...args: unknown[]) => mockLoadResumeData(...args),
}));

const mockRunPhase = vi.fn();

vi.mock("../phase-runner/index.js", () => ({
  runPhase: (...args: unknown[]) => mockRunPhase(...args),
}));

vi.mock("../sdk/index.js", () => ({
  executeQuery: vi.fn(),
}));

vi.mock("./traceability.js", () => ({
  createTestGuide: vi.fn(),
  injectTestingMethodology: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestConfig(): ForgeConfig {
  return {
    model: "claude-opus-4-6",
    maxBudgetTotal: 200,
    maxBudgetPerStep: 15,
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

function createTestState(overrides?: Partial<ForgeState>): ForgeState {
  return {
    projectDir: "/test/project",
    startedAt: "2026-01-01T00:00:00Z",
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "wave_1",
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1.2 },
    },
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 10,
      verified: 8,
      gapHistory: [],
      roundsCompleted: 1,
    },
    remainingGaps: ["R9", "R10"],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 3.7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createCli", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as (code?: number) => never);
    mockLoadConfig.mockResolvedValue(createTestConfig());
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("returns a Command with 5 subcommands", async () => {
    const { createCli } = await import("./index.js");
    const cli = createCli();

    expect(cli.name()).toBe("forge");
    expect(cli.description()).toBe(
      "Autonomous software development orchestrator",
    );

    const commandNames = cli.commands.map((c) => c.name());
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("phase");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("resume");
    expect(commandNames).toHaveLength(5);
  });

  it("command names and descriptions match expected values", async () => {
    const { createCli } = await import("./index.js");
    const cli = createCli();

    const commandMap = new Map(cli.commands.map((c) => [c.name(), c.description()]));
    expect(commandMap.get("init")).toBe("Start interactive requirements gathering");
    expect(commandMap.get("run")).toBe("Execute full wave model autonomously");
    expect(commandMap.get("phase")).toBe("Run a single phase");
    expect(commandMap.get("status")).toBe("Display project status");
    expect(commandMap.get("resume")).toBe("Continue from checkpoint");
  });

  it("forge init creates state file", async () => {
    const testState = createTestState();
    mockCreateInitialState.mockReturnValue(testState);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "init"]);

    expect(mockLoadConfig).toHaveBeenCalled();
    expect(mockCreateInitialState).toHaveBeenCalled();
    expect(mockStateManager.save).toHaveBeenCalledWith(testState);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Project initialized"),
    );
  });

  it("forge status calls formatStatus with loaded state", async () => {
    const testState = createTestState();
    mockStateManager.exists.mockReturnValue(true);
    mockStateManager.load.mockReturnValue(testState);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "status"]);

    expect(mockStateManager.exists).toHaveBeenCalled();
    expect(mockStateManager.load).toHaveBeenCalled();

    // Verify the output contains status-formatted content
    const output = consoleSpy.mock.calls
      .map((c) => c[0])
      .join("\n");
    expect(output).toContain("FORGE -- Project Status");
    expect(output).toContain("Phase Progress:");
    expect(output).toContain("Budget:");
  });

  it("forge status prints message when no project found", async () => {
    mockStateManager.exists.mockReturnValue(false);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "status"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      "No forge project found. Run `forge init` first.",
    );
  });

  it("forge run delegates to runPipeline and handles completed result", async () => {
    const completedResult: PipelineResult = {
      status: "completed",
      wavesCompleted: 3,
      phasesCompleted: [1, 2, 3],
      totalCostUsd: 15.5,
      specCompliance: {
        converged: true,
        roundsCompleted: 2,
        gapHistory: [3, 0],
        remainingGaps: [],
      },
    };
    mockRunPipeline.mockResolvedValue(completedResult);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "run"]);

    expect(mockRunPipeline).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Pipeline completed successfully");
    expect(output).toContain("$15.50");
  });

  it("forge run handles failed result with exit code 1", async () => {
    const failedResult: PipelineResult = {
      status: "failed",
      wave: 1,
      reason: "Phase 2 build errors",
      phasesCompletedSoFar: [1],
      phasesFailed: [2],
    };
    mockRunPipeline.mockResolvedValue(failedResult);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "run"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Pipeline failed");
  });

  it("forge phase delegates to runPhase for single-phase execution", async () => {
    const completedResult: PhaseResult = {
      status: "completed",
      report: "Phase 3 completed with all tests passing.",
    };
    mockRunPhase.mockResolvedValue(completedResult);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "phase", "3"]);

    expect(mockRunPhase).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        config: expect.any(Object),
        stateManager: expect.any(Object),
      }),
    );
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Phase 3 completed successfully");
  });

  it("forge resume without --env prints error", async () => {
    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "resume"]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--env <file> is required");
  });

  it("forge resume with --env loads resume data and runs pipeline", async () => {
    mockLoadResumeData.mockReturnValue({
      credentials: { STRIPE_KEY: "sk_test_123" },
      guidance: { R7: "Use SSE instead" },
    });
    mockStateManager.update.mockImplementation(
      async (fn: (s: ForgeState) => ForgeState) => {
        return fn(createTestState());
      },
    );
    const completedResult: PipelineResult = {
      status: "completed",
      wavesCompleted: 3,
      phasesCompleted: [1, 2, 3],
      totalCostUsd: 25.0,
      specCompliance: {
        converged: true,
        roundsCompleted: 1,
        gapHistory: [0],
        remainingGaps: [],
      },
    };
    mockRunPipeline.mockResolvedValue(completedResult);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "resume", "--env", ".env.production"]);

    expect(mockLoadResumeData).toHaveBeenCalledWith(
      ".env.production",
      undefined,
    );
    expect(mockStateManager.update).toHaveBeenCalled();
    expect(mockRunPipeline).toHaveBeenCalled();
  });

  it("formatStatus is called with the correct state shape for status command", async () => {
    const testState = createTestState({
      status: "wave_2",
      currentWave: 2,
      totalBudgetUsed: 45.0,
    });
    mockStateManager.exists.mockReturnValue(true);
    mockStateManager.load.mockReturnValue(testState);

    const { createCli } = await import("./index.js");
    const cli = createCli();
    await cli.parseAsync(["node", "forge", "status"]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    // Verify state fields are reflected in output
    expect(output).toContain("Status: wave_2 | Wave: 2");
    expect(output).toContain("$45.00");
  });
});
