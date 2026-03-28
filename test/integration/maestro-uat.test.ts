/**
 * Integration Tests: Maestro UAT Flow
 *
 * Tests the integration between the UAT runner, emulator lifecycle,
 * flutter run daemon, and Maestro test execution.
 *
 * All tests use mocked dependencies — no real processes or Maestro CLI.
 *
 * Requirements: MAE-01 through MAE-07
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectAppType,
  buildUATPrompt,
  runFlutterUAT,
} from "../../src/uat/runner.js";
import { buildMaestroContextBlock } from "../../src/pipeline/prompts.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import type { UATContext } from "../../src/uat/types.js";
import type { StateManager } from "../../src/state/state-manager.js";
import type { CostController } from "../../src/step-runner/cost-controller.js";
import type { StepRunnerContext } from "../../src/step-runner/types.js";
import { BudgetExceededError } from "../../src/step-runner/types.js";

// ---------------------------------------------------------------------------
// Mock emulator + flutter run + maestro modules
// ---------------------------------------------------------------------------

vi.mock("../../src/uat/emulator.js", () => ({
  withEmulator: vi.fn(),
  startEmulator: vi.fn(),
  waitForBoot: vi.fn(),
  stopEmulator: vi.fn(),
  registerCleanupHandler: vi.fn(() => () => {}),
  killOrphanEmulators: vi.fn().mockResolvedValue([]),
  persistEmulatorState: vi.fn(),
  clearEmulatorState: vi.fn(),
  listEmulatorSerials: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/uat/flutter-run.js", () => ({
  withFlutterRun: vi.fn(),
  startFlutterRun: vi.fn(),
  waitForFlutterRunReady: vi.fn(),
  stopFlutterRun: vi.fn(),
  registerFlutterRunCleanup: vi.fn(() => () => {}),
}));

vi.mock("../../src/uat/maestro.js", () => ({
  executeMaestroUAT: vi.fn(),
  maestroResultToWorkflowResults: vi.fn(),
  runMaestroTest: vi.fn(),
  parseMaestroJUnit: vi.fn(),
  reconcileResult: vi.fn(),
}));

// Import the mocked modules to configure them
import { withEmulator } from "../../src/uat/emulator.js";
import { withFlutterRun } from "../../src/uat/flutter-run.js";
import {
  executeMaestroUAT,
  maestroResultToWorkflowResults,
} from "../../src/uat/maestro.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockConfig(overrides?: Partial<ForgeConfig>): ForgeConfig {
  return {
    model: "test",
    maxBudgetTotal: 100,
    maxBudgetPerStep: 10,
    maxRetries: 2,
    maxComplianceRounds: 3,
    maxTurnsPerStep: 50,
    testing: {
      stack: "flutter",
      unitCommand: "flutter test",
      integrationCommand: "flutter test integration_test",
      scenarioCommand: "",
      dockerComposeFile: "docker-compose.test.yml",
      flutterAvdName: "test-avd",
      flutterBuildFlavor: "",
      maestroFlowsDir: ".maestro",
    },
    verification: {
      files: true,
      tests: true,
      typecheck: false,
      lint: false,
      dockerSmoke: false,
      testCoverageCheck: false,
      observabilityCheck: false,
      deployment: false,
      mobileBuild: true,
      mobileAnalyze: true,
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
      maxConcurrentPhases: 1,
      enableSubagents: false,
      backgroundDocs: false,
    },
    frontend: {
      hasGui: false,
      designInteractive: false,
      designOptionsCount: 3,
    },
    deployment: {
      target: "none",
      environments: [],
    },
    notifications: {
      onHumanNeeded: "stdout",
      onPhaseComplete: "stdout",
      onFailure: "stdout",
    },
    ...overrides,
  };
}

function createMockUATContext(
  configOverrides?: Partial<ForgeConfig>,
): UATContext {
  const reqContent = `## R1: Login Flow

**Acceptance Criteria:**
- User can enter email and password
- User sees home screen after login

## R2: Add Items

**Acceptance Criteria:**
- User can add a new item
- Item appears in the list
`;

  return {
    config: createMockConfig(configOverrides),
    stateManager: {
      load: vi.fn().mockReturnValue({ uatResults: {} }),
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as StateManager,
    stepRunnerContext: {} as StepRunnerContext,
    costController: {} as CostController,
    fs: {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(reqContent),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    runStepFn: vi.fn().mockResolvedValue({ status: "completed" }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Maestro UAT Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // App type detection routing
  // =========================================================================

  describe("detectAppType routing", () => {
    it("TestAppTypeDetection_FlutterRoutesToFlutterUAT", () => {
      const config = createMockConfig({ testing: { ...createMockConfig().testing, stack: "flutter" } });
      const appType = detectAppType(config);
      expect(appType).toBe("flutter");
    });

    it("TestAppTypeDetection_WebStillRoutesToWebUAT", () => {
      const config = createMockConfig({
        testing: { ...createMockConfig().testing, stack: "react" },
      });
      const appType = detectAppType(config);
      expect(appType).toBe("web");
    });
  });

  // =========================================================================
  // runFlutterUAT integration
  // =========================================================================

  describe("runFlutterUAT", () => {
    it("TestFlutterUAT_OrchestratesEmulatorAndFlutterRun", async () => {
      const ctx = createMockUATContext();

      // Setup: withEmulator calls its callback with a handle
      vi.mocked(withEmulator).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 1234,
          serial: "emulator-5554",
          avdName: "test-avd",
          startedAt: new Date().toISOString(),
        });
      });

      // Setup: withFlutterRun calls its callback
      vi.mocked(withFlutterRun).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 5678,
          startedAt: new Date().toISOString(),
        });
      });

      // Setup: Maestro returns all passing
      vi.mocked(executeMaestroUAT).mockResolvedValue({
        passed: true,
        totalFlows: 2,
        passedFlows: 2,
        failedFlows: 0,
        flowResults: [
          { name: "login", passed: true, durationMs: 3000 },
          { name: "add-item", passed: true, durationMs: 2000 },
        ],
      });

      vi.mocked(maestroResultToWorkflowResults).mockReturnValue([
        {
          workflowId: "maestro-login",
          passed: true,
          stepsPassed: 1,
          stepsFailed: 0,
          errors: [],
          durationMs: 3000,
        },
        {
          workflowId: "maestro-add-item",
          passed: true,
          stepsPassed: 1,
          stepsFailed: 0,
          errors: [],
          durationMs: 2000,
        },
      ]);

      const result = await runFlutterUAT(ctx);

      expect(result.status).toBe("passed");
      expect(result.workflowsTested).toBe(2);
      expect(result.workflowsPassed).toBe(2);
      expect(result.workflowsFailed).toBe(0);
      expect(withEmulator).toHaveBeenCalledOnce();
      expect(withFlutterRun).toHaveBeenCalledOnce();
      expect(executeMaestroUAT).toHaveBeenCalledOnce();
    });

    it("TestFlutterUAT_GapClosureOnFailure", async () => {
      const ctx = createMockUATContext();
      let callCount = 0;

      vi.mocked(withEmulator).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 1234,
          serial: "emulator-5554",
          avdName: "test-avd",
          startedAt: new Date().toISOString(),
        });
      });

      vi.mocked(withFlutterRun).mockImplementation(async (opts, callback) => {
        return callback({ pid: 5678, startedAt: new Date().toISOString() });
      });

      // First call: failure, second call: success
      vi.mocked(executeMaestroUAT).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            passed: false,
            totalFlows: 1,
            passedFlows: 0,
            failedFlows: 1,
            flowResults: [
              { name: "login", passed: false, durationMs: 3000, error: "Not found" },
            ],
          };
        }
        return {
          passed: true,
          totalFlows: 1,
          passedFlows: 1,
          failedFlows: 0,
          flowResults: [{ name: "login", passed: true, durationMs: 3000 }],
        };
      });

      vi.mocked(maestroResultToWorkflowResults).mockImplementation((result) => {
        return result.flowResults.map((f) => ({
          workflowId: `maestro-${f.name}`,
          passed: f.passed,
          stepsPassed: f.passed ? 1 : 0,
          stepsFailed: f.passed ? 0 : 1,
          errors: f.error ? [f.error] : [],
          durationMs: f.durationMs,
        }));
      });

      const result = await runFlutterUAT(ctx);

      expect(result.status).toBe("passed");
      expect(result.attemptsUsed).toBe(2);
      // Verify gap closure step was executed
      expect(ctx.runStepFn).toHaveBeenCalledTimes(2); // flow gen + gap closure
    });

    it("TestFlutterUAT_RetriesUpToMaxRetries", async () => {
      const ctx = createMockUATContext();

      vi.mocked(withEmulator).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 1234,
          serial: "emulator-5554",
          avdName: "test-avd",
          startedAt: new Date().toISOString(),
        });
      });

      vi.mocked(withFlutterRun).mockImplementation(async (opts, callback) => {
        return callback({ pid: 5678, startedAt: new Date().toISOString() });
      });

      // Always fails
      vi.mocked(executeMaestroUAT).mockResolvedValue({
        passed: false,
        totalFlows: 1,
        passedFlows: 0,
        failedFlows: 1,
        flowResults: [
          { name: "login", passed: false, durationMs: 3000, error: "Still broken" },
        ],
      });

      vi.mocked(maestroResultToWorkflowResults).mockReturnValue([
        {
          workflowId: "maestro-login",
          passed: false,
          stepsPassed: 0,
          stepsFailed: 1,
          errors: ["Still broken"],
          durationMs: 3000,
        },
      ]);

      const result = await runFlutterUAT(ctx);

      expect(result.status).toBe("stuck");
      // maxRetries=2 → up to 3 attempts (1 initial + 2 retries)
      expect(executeMaestroUAT).toHaveBeenCalledTimes(3);
    });

    it("TestFlutterUAT_BudgetExceededPropagates", async () => {
      const ctx = createMockUATContext();

      vi.mocked(withEmulator).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 1234,
          serial: "emulator-5554",
          avdName: "test-avd",
          startedAt: new Date().toISOString(),
        });
      });

      vi.mocked(withFlutterRun).mockImplementation(async (opts, callback) => {
        return callback({ pid: 5678, startedAt: new Date().toISOString() });
      });

      // Step runner throws budget exceeded
      (ctx.runStepFn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new BudgetExceededError(100, 100),
      );

      await expect(runFlutterUAT(ctx)).rejects.toThrow(BudgetExceededError);
    });

    it("TestFlutterUAT_CleansUpOnMaestroFailure", async () => {
      const ctx = createMockUATContext();

      // withEmulator calls callback, verifying cleanup happens
      vi.mocked(withEmulator).mockImplementation(async (opts, callback) => {
        return callback({
          pid: 1234,
          serial: "emulator-5554",
          avdName: "test-avd",
          startedAt: new Date().toISOString(),
        });
      });

      // withFlutterRun's try/finally ensures cleanup
      vi.mocked(withFlutterRun).mockImplementation(async (opts, callback) => {
        return callback({ pid: 5678, startedAt: new Date().toISOString() });
      });

      // Maestro throws an unexpected error
      vi.mocked(executeMaestroUAT).mockRejectedValue(
        new Error("Maestro crashed"),
      );

      // This makes flow gen succeed but maestro fail
      let flowGenCalled = false;
      (ctx.runStepFn as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          flowGenCalled = true;
          return { status: "completed" };
        },
      );

      vi.mocked(maestroResultToWorkflowResults).mockReturnValue([]);

      const result = await runFlutterUAT(ctx);

      // Should return stuck (not throw)
      expect(result.status).toBe("stuck");
      // withEmulator and withFlutterRun cleanup was triggered by their try/finally
      expect(withEmulator).toHaveBeenCalledOnce();
      expect(withFlutterRun).toHaveBeenCalledOnce();
    });
  });

  // =========================================================================
  // Prompt content
  // =========================================================================

  describe("prompt content", () => {
    it("TestUATPrompt_FlutterIncludesSemanticGuidance", () => {
      const prompt = buildUATPrompt(
        {
          id: "UAT-R1-01",
          requirementId: "R1",
          description: "Login flow",
          steps: ["Enter email", "Enter password"],
          appType: "flutter",
        },
        "flutter",
        "Safety guardrails here.",
      );

      expect(prompt).toContain("ValueKey");
      expect(prompt).toContain("semantic-id");
      expect(prompt).toContain("waitForAnimationToEnd");
      expect(prompt).toContain("Widget Identification");
      expect(prompt).toContain("Maestro Flow Requirements");
      expect(prompt).toContain("clearState");
    });

    it("TestMaestroContext_IncludesWidgetKeyGuidance", () => {
      const block = buildMaestroContextBlock();

      expect(block).toContain("Maestro UAT Readiness");
      expect(block).toContain("ValueKey");
      expect(block).toContain("login-button");
      expect(block).toContain("email-input");
      expect(block).toContain("Animation Handling");
      expect(block).toContain("MaterialApp");
    });
  });
});
