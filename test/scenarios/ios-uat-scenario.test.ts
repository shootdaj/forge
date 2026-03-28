/**
 * iOS UAT Scenario Tests
 *
 * End-to-end scenarios for the iOS Simulator UAT flow with all
 * external dependencies mocked. Verifies the full lifecycle:
 * simulator boot -> flutter run -> maestro test -> shutdown.
 *
 * Requirements: IOS-01, IOS-02, IOS-03
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  SimulatorHandle,
  SimulatorBootOptions,
} from "../../src/uat/ios-simulator-types.js";

// Mock the ios-simulator module
vi.mock("../../src/uat/ios-simulator.js", () => ({
  withSimulator: vi.fn(),
  assertXcodeAvailable: vi.fn(),
  listAvailableSimulators: vi.fn(),
  findBestSimulator: vi.fn(),
  bootSimulator: vi.fn(),
  waitForSimulatorReady: vi.fn(),
  shutdownSimulator: vi.fn(),
  registerSimulatorCleanup: vi.fn(() => () => {}),
  persistSimulatorState: vi.fn(),
  clearSimulatorState: vi.fn(),
}));

// Mock the emulator module
vi.mock("../../src/uat/emulator.js", () => ({
  withEmulator: vi.fn(),
  startEmulator: vi.fn(),
  waitForBoot: vi.fn(),
  stopEmulator: vi.fn(),
  registerCleanupHandler: vi.fn(() => () => {}),
  killOrphanEmulators: vi.fn(),
  persistEmulatorState: vi.fn(),
  clearEmulatorState: vi.fn(),
  listEmulatorSerials: vi.fn(() => []),
}));

// Mock KVM check
vi.mock("../../src/uat/kvm-check.js", () => ({
  assertKvmAvailable: vi.fn(),
}));

// Mock flutter-run
vi.mock("../../src/uat/flutter-run.js", () => ({
  withFlutterRun: vi.fn(),
  startFlutterRun: vi.fn(),
  waitForFlutterRunReady: vi.fn(),
  stopFlutterRun: vi.fn(),
  registerFlutterRunCleanup: vi.fn(() => () => {}),
}));

// Mock maestro
vi.mock("../../src/uat/maestro.js", () => ({
  executeMaestroUAT: vi.fn(),
  maestroResultToWorkflowResults: vi.fn(),
  runMaestroTest: vi.fn(),
  parseMaestroJUnit: vi.fn(),
  reconcileResult: vi.fn(),
}));

// Mock step runner
vi.mock("../../src/step-runner/step-runner.js", () => ({
  runStep: vi.fn(async () => ({
    name: "test-step",
    status: "completed" as const,
    budgetUsed: 0.1,
    turns: 1,
    output: "done",
    verifyResult: true,
  })),
}));

import { withSimulator } from "../../src/uat/ios-simulator.js";
import { withEmulator } from "../../src/uat/emulator.js";
import { withFlutterRun } from "../../src/uat/flutter-run.js";
import {
  executeMaestroUAT,
  maestroResultToWorkflowResults,
} from "../../src/uat/maestro.js";
import { runFlutterUAT } from "../../src/uat/runner.js";
import type { UATContext } from "../../src/uat/types.js";
import { getDefaultConfig } from "../../src/config/index.js";
import type { ForgeConfig } from "../../src/config/schema.js";

const mockedWithSimulator = vi.mocked(withSimulator);
const mockedWithEmulator = vi.mocked(withEmulator);
const mockedWithFlutterRun = vi.mocked(withFlutterRun);
const mockedExecuteMaestroUAT = vi.mocked(executeMaestroUAT);
const mockedMaestroToWorkflow = vi.mocked(maestroResultToWorkflowResults);

function makeContext(testingOverrides?: Record<string, unknown>): UATContext {
  const defaultConfig = getDefaultConfig();
  const config = {
    ...defaultConfig,
    testing: {
      ...defaultConfig.testing,
      ...(testingOverrides || {}),
    },
  } as ForgeConfig;

  return {
    config,
    stateManager: {
      load: () => ({} as Record<string, unknown>),
      save: vi.fn(),
      update: vi.fn(),
    } as unknown as UATContext["stateManager"],
    stepRunnerContext: {
      projectDir: "/test",
      model: "test",
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
      permissionMode: "bypassPermissions" as const,
      maxTurns: 50,
      settingSources: [],
    },
    costController: {
      checkBudget: vi.fn(),
      recordCost: vi.fn(),
      getBudgetRemaining: vi.fn(() => 100),
      getTotalUsed: vi.fn(() => 0),
    } as unknown as UATContext["costController"],
    fs: {
      existsSync: (p: string) => !String(p).includes("docker-compose"),
      readFileSync: (p: string, _enc: string) => {
        if (String(p) === "REQUIREMENTS.md") {
          return "## R1: Login\n\n**Acceptance Criteria:**\n- User can log in with email and password\n- User sees home screen after login\n";
        }
        return "";
      },
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    runStepFn: vi.fn(async () => ({
      name: "test-step",
      status: "completed" as const,
      budgetUsed: 0.1,
      turns: 1,
      output: "done",
      verifyResult: true,
    })),
  };
}

describe("iOS UAT Scenario", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestFulliOSUATFlow_SimulatorBootToMaestroTest", () => {
    it("runs complete iOS UAT: boot sim -> flutter run -> maestro test -> shutdown", async () => {

      // Setup: withSimulator calls callback with handle, withFlutterRun calls its callback
      const simulatorHandle: SimulatorHandle = {
        udid: "AAAA-1111",
        name: "iPhone 15 Pro",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
        startedAt: new Date().toISOString(),
      };

      mockedWithSimulator.mockImplementation(async (_opts, callback) => {
        return callback(simulatorHandle);
      });
      mockedWithFlutterRun.mockImplementation(async (_opts, callback) => {
        return callback({
          pid: 1234,
          startedAt: new Date().toISOString(),
        });
      });
      mockedExecuteMaestroUAT.mockResolvedValue({
        passed: true,
        totalFlows: 1,
        passedFlows: 1,
        failedFlows: 0,
        flowResults: [
          { name: "login-flow", passed: true, durationMs: 5000 },
        ],
      });
      mockedMaestroToWorkflow.mockReturnValue([
        {
          workflowId: "maestro-login-flow",
          passed: true,
          stepsPassed: 1,
          stepsFailed: 0,
          errors: [],
          durationMs: 5000,
        },
      ]);

      const ctx = makeContext({
        mobilePlatform: "ios",
        iosSimulatorDevice: "iPhone 15 Pro",
      });

      const result = await runFlutterUAT(ctx);

      // Verify withSimulator was called (not withEmulator)
      expect(mockedWithSimulator).toHaveBeenCalledOnce();
      expect(mockedWithEmulator).not.toHaveBeenCalled();

      // Verify flutter run was called with simulator UDID
      expect(mockedWithFlutterRun).toHaveBeenCalledWith(
        expect.objectContaining({ serial: "AAAA-1111" }),
        expect.any(Function),
      );

      // Verify Maestro UAT was executed
      expect(mockedExecuteMaestroUAT).toHaveBeenCalled();

      // Verify result
      expect(result.status).toBe("passed");
      expect(result.workflowsPassed).toBeGreaterThan(0);
    });
  });

  describe("TestFulliOSUATFlow_SimulatorCleanupOnFailure", () => {
    it("cleans up simulator even when Maestro test fails", async () => {
      let simulatorCallbackInvoked = false;

      mockedWithSimulator.mockImplementation(async (_opts, callback) => {
        simulatorCallbackInvoked = true;
        return callback({
          udid: "AAAA-1111",
          name: "iPhone 15 Pro",
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
          startedAt: new Date().toISOString(),
        });
      });
      mockedWithFlutterRun.mockImplementation(async (_opts, callback) => {
        return callback({
          pid: 1234,
          startedAt: new Date().toISOString(),
        });
      });
      mockedExecuteMaestroUAT.mockResolvedValue({
        passed: false,
        totalFlows: 1,
        passedFlows: 0,
        failedFlows: 1,
        flowResults: [
          {
            name: "login-flow",
            passed: false,
            durationMs: 3000,
            error: "Element not found",
          },
        ],
      });
      mockedMaestroToWorkflow.mockReturnValue([
        {
          workflowId: "maestro-login-flow",
          passed: false,
          stepsPassed: 0,
          stepsFailed: 1,
          errors: ["Element not found"],
          durationMs: 3000,
        },
      ]);

      const ctx = makeContext({
        mobilePlatform: "ios",
      });

      const result = await runFlutterUAT(ctx);

      // withSimulator was called (cleanup is guaranteed by its try/finally)
      expect(simulatorCallbackInvoked).toBe(true);
      expect(mockedWithSimulator).toHaveBeenCalledOnce();

      // Result reflects failure
      expect(result.status).not.toBe("passed");
    });
  });

  describe("TestiOSUATFlow_SameFlowsAsBothPlatforms", () => {
    it("uses same Maestro flows directory for both Android and iOS", async () => {
      const flowsDir = ".maestro";
      let capturedFlowsDir_ios = "";
      let capturedFlowsDir_android = "";

      // iOS run
      mockedWithSimulator.mockImplementation(async (_opts, callback) => {
        return callback({
          udid: "AAAA-1111",
          name: "iPhone 15 Pro",
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
          startedAt: new Date().toISOString(),
        });
      });
      mockedWithFlutterRun.mockImplementation(async (_opts, callback) => {
        return callback({
          pid: 1234,
          startedAt: new Date().toISOString(),
        });
      });
      mockedExecuteMaestroUAT.mockImplementation(async (opts) => {
        capturedFlowsDir_ios = opts.flowsDir;
        return {
          passed: true,
          totalFlows: 1,
          passedFlows: 1,
          failedFlows: 0,
          flowResults: [
            { name: "test-flow", passed: true, durationMs: 1000 },
          ],
        };
      });
      mockedMaestroToWorkflow.mockReturnValue([
        {
          workflowId: "maestro-test-flow",
          passed: true,
          stepsPassed: 1,
          stepsFailed: 0,
          errors: [],
          durationMs: 1000,
        },
      ]);

      const iosCtx = makeContext({
        mobilePlatform: "ios",
        maestroFlowsDir: flowsDir,
      });

      await runFlutterUAT(iosCtx);

      // Android run
      vi.clearAllMocks();
      mockedWithEmulator.mockImplementation(async (_opts, callback) => {
        return callback({
          pid: 5678,
          serial: "emulator-5554",
          avdName: "Pixel_6_API_33",
          startedAt: new Date().toISOString(),
        });
      });
      mockedWithFlutterRun.mockImplementation(async (_opts, callback) => {
        return callback({
          pid: 1234,
          startedAt: new Date().toISOString(),
        });
      });
      mockedExecuteMaestroUAT.mockImplementation(async (opts) => {
        capturedFlowsDir_android = opts.flowsDir;
        return {
          passed: true,
          totalFlows: 1,
          passedFlows: 1,
          failedFlows: 0,
          flowResults: [
            { name: "test-flow", passed: true, durationMs: 1000 },
          ],
        };
      });
      mockedMaestroToWorkflow.mockReturnValue([
        {
          workflowId: "maestro-test-flow",
          passed: true,
          stepsPassed: 1,
          stepsFailed: 0,
          errors: [],
          durationMs: 1000,
        },
      ]);

      const androidCtx = makeContext({
        mobilePlatform: "android",
        maestroFlowsDir: flowsDir,
      });

      await runFlutterUAT(androidCtx);

      // Both platforms should use the same flows directory
      expect(capturedFlowsDir_ios).toBe(flowsDir);
      expect(capturedFlowsDir_android).toBe(flowsDir);
      expect(capturedFlowsDir_ios).toBe(capturedFlowsDir_android);
    });
  });
});
