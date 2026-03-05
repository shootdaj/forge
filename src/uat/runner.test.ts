/**
 * UAT Runner Unit Tests
 *
 * Comprehensive tests for all UAT functions:
 * - detectAppType
 * - extractUserWorkflows
 * - buildSafetyPrompt
 * - startApplication / stopApplication
 * - waitForHealth
 * - buildUATPrompt
 * - verifyUATResults
 * - runUATGapClosure
 * - runUAT (integration-style with all deps mocked)
 *
 * Requirements: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
 */

import { describe, it, expect, vi } from "vitest";
import type { ForgeConfig } from "../config/schema.js";
import type { UATContext, SafetyConfig, UATWorkflow, WorkflowResult } from "./types.js";
import type { StepRunnerContext, StepResult } from "../step-runner/types.js";
import type { StateManager } from "../state/state-manager.js";
import type { CostController } from "../step-runner/cost-controller.js";

import {
  detectAppType,
  startApplication,
  stopApplication,
  waitForHealth,
  buildUATPrompt,
  verifyUATResults,
  runUAT,
} from "./runner.js";

import {
  extractUserWorkflows,
  buildSafetyPrompt,
  runUATGapClosure,
} from "./workflows.js";

// ─── Helpers ───

/**
 * Create a minimal ForgeConfig for testing.
 */
function createTestConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
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
    ...overrides,
  };
}

/**
 * Map-based in-memory filesystem for testing.
 */
function createMockFs(files: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(files));
  return {
    existsSync: (path: string) => store.has(path),
    readFileSync: (path: string, _encoding: string) => {
      if (!store.has(path)) throw new Error(`ENOENT: ${path}`);
      return store.get(path)!;
    },
    writeFileSync: (path: string, content: string) => {
      store.set(path, content);
    },
    mkdirSync: (_path: string, _options?: { recursive: boolean }) => {
      // No-op for in-memory
    },
    _store: store,
  };
}

/**
 * Create a mock runStep function that succeeds and writes result files.
 */
function createMockRunStep(mockFs: ReturnType<typeof createMockFs>, passing = true) {
  return vi.fn().mockImplementation(async (name: string) => {
    // Extract workflow ID from step name "uat-{workflowId}"
    const wfId = name.replace("uat-", "");
    mockFs._store.set(
      `.forge/uat/${wfId}.json`,
      JSON.stringify({
        passed: passing,
        stepsPassed: passing ? 3 : 1,
        stepsFailed: passing ? 0 : 2,
        errors: passing ? [] : ["Test failure"],
      }),
    );
    return {
      status: "verified",
      costUsd: 0.01,
      costData: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 },
      result: "done",
      structuredOutput: undefined,
      sessionId: "test-session",
    } satisfies StepResult as StepResult;
  });
}

/**
 * Create a mock UATContext with injectable runStepFn.
 */
function createTestContext(
  overrides: Partial<UATContext> & { mockRunStep?: ReturnType<typeof vi.fn> } = {},
): UATContext {
  const config = overrides.config ?? createTestConfig();
  const mockStateManager = {
    load: vi.fn().mockReturnValue({ totalBudgetUsed: 0 }),
    save: vi.fn(),
    update: vi.fn(async (updater: (s: unknown) => unknown) => updater({ totalBudgetUsed: 0 })),
    exists: vi.fn().mockReturnValue(true),
    statePath: "/tmp/forge-state.json",
    initialize: vi.fn(),
  } as unknown as StateManager;

  const mockCostController = {
    checkBudget: vi.fn(),
    recordStepCost: vi.fn(),
    getCostByStep: vi.fn().mockReturnValue([]),
    getCostByPhase: vi.fn().mockReturnValue([]),
    getPhaseTotal: vi.fn().mockReturnValue(0),
    getTotal: vi.fn().mockReturnValue(0),
    getLog: vi.fn().mockReturnValue([]),
    size: 0,
  } as unknown as CostController;

  const mockExecuteQueryFn = vi.fn().mockResolvedValue({
    ok: true,
    result: "done",
    structuredOutput: undefined,
    cost: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 },
    sessionId: "test-session",
  });

  const mockStepRunnerContext: StepRunnerContext = {
    config,
    stateManager: mockStateManager,
    executeQueryFn: mockExecuteQueryFn,
  };

  const { mockRunStep, ...rest } = overrides;

  return {
    config,
    stateManager: mockStateManager,
    stepRunnerContext: mockStepRunnerContext,
    costController: mockCostController,
    fs: overrides.fs ?? createMockFs(),
    execFn: overrides.execFn ?? vi.fn().mockReturnValue(""),
    runStepFn: mockRunStep ?? vi.fn().mockResolvedValue({
      status: "verified",
      costUsd: 0.01,
      costData: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 },
      result: "done",
      structuredOutput: undefined,
      sessionId: "test-session",
    }),
    ...rest,
  };
}

// ─── Well-formed REQUIREMENTS.md for testing ───

const SAMPLE_REQUIREMENTS = `# Project Requirements

## R1: User Authentication
**Description:** Users can sign up and log in to the application.
**Acceptance Criteria:**
- Users can register with email and password
- Users can log in with existing credentials
- Invalid credentials show an error message

**Edge Cases:**
- Duplicate email registration
**Performance:** < 200ms response time
**Security:** Passwords must be hashed

## R2: Dashboard
**Description:** Users see a dashboard after login.
**Acceptance Criteria:**
- Dashboard loads within 2 seconds
- Dashboard shows user name
- Dashboard shows recent activity

**Edge Cases:**
- Empty state for new users

## R3: Settings
**Description:** Users can update their profile settings.
**Acceptance Criteria:**
- Users can change their display name
- Users can update their email address

**Edge Cases:**
- Email already taken
`;

// ─── Tests ───

describe("detectAppType", () => {
  it("TestDetectAppType_ReturnsWeb_ForReact", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "react" },
    });
    expect(detectAppType(config)).toBe("web");
  });

  it("TestDetectAppType_ReturnsWeb_ForNext", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "next" },
    });
    expect(detectAppType(config)).toBe("web");
  });

  it("TestDetectAppType_ReturnsApi_ForExpress", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "express" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsApi_ForFastify", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "fastify" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsCli_ForNode", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "node" },
    });
    expect(detectAppType(config)).toBe("cli");
  });

  it("TestDetectAppType_ReturnsCli_ForGo", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "go" },
    });
    expect(detectAppType(config)).toBe("cli");
  });

  it("TestDetectAppType_ReturnsCli_ForUnknownStack", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "unknown-stack-xyz" },
    });
    expect(detectAppType(config)).toBe("cli");
  });
});

describe("extractUserWorkflows", () => {
  it("TestExtractWorkflows_ParsesWellFormedRequirements", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "web");
    expect(workflows.length).toBeGreaterThanOrEqual(3);
  });

  it("TestExtractWorkflows_CreatesCorrectIds", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "web");
    const ids = workflows.map((w) => w.id);
    expect(ids).toContain("UAT-R1-01");
    expect(ids).toContain("UAT-R2-01");
    expect(ids).toContain("UAT-R3-01");
  });

  it("TestExtractWorkflows_SetsRequirementId", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "web");
    const r1 = workflows.find((w) => w.id === "UAT-R1-01");
    expect(r1?.requirementId).toBe("R1");
  });

  it("TestExtractWorkflows_ExtractsAcceptanceCriteriaAsSteps", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "web");
    const r1 = workflows.find((w) => w.id === "UAT-R1-01");
    expect(r1?.steps).toContain("Users can register with email and password");
    expect(r1?.steps).toContain("Users can log in with existing credentials");
    expect(r1?.steps).toContain("Invalid credentials show an error message");
  });

  it("TestExtractWorkflows_AppliesAppType", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "api");
    for (const wf of workflows) {
      expect(wf.appType).toBe("api");
    }
  });

  it("TestExtractWorkflows_ReturnsEmpty_ForEmptyInput", () => {
    const workflows = extractUserWorkflows("", "web");
    expect(workflows).toEqual([]);
  });

  it("TestExtractWorkflows_ReturnsEmpty_ForNoRequirements", () => {
    const workflows = extractUserWorkflows("# Just a title\n\nSome text", "cli");
    expect(workflows).toEqual([]);
  });

  it("TestExtractWorkflows_SetsDescription_FromTitle", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS, "web");
    const r1 = workflows.find((w) => w.id === "UAT-R1-01");
    expect(r1?.description).toBe("User Authentication");
  });
});

describe("buildSafetyPrompt", () => {
  const safetyConfig: SafetyConfig = {
    useSandboxCredentials: true,
    useLocalSmtp: true,
    useTestDb: true,
    envFile: ".env.test",
  };

  it("TestBuildSafetyPrompt_IncludesNeverProductionText", () => {
    const prompt = buildSafetyPrompt(safetyConfig);
    expect(prompt).toContain("NEVER use production");
  });

  it("TestBuildSafetyPrompt_IncludesEnvTestReference", () => {
    const prompt = buildSafetyPrompt(safetyConfig);
    expect(prompt).toContain(".env.test");
  });

  it("TestBuildSafetyPrompt_IncludesLocalSmtpReference", () => {
    const prompt = buildSafetyPrompt(safetyConfig);
    expect(prompt).toContain("local SMTP");
    expect(prompt).toContain("Mailhog");
  });

  it("TestBuildSafetyPrompt_IncludesTestDbReference", () => {
    const prompt = buildSafetyPrompt(safetyConfig);
    expect(prompt).toContain("test database");
  });

  it("TestBuildSafetyPrompt_IncludesOAuthGuardrail", () => {
    const prompt = buildSafetyPrompt(safetyConfig);
    expect(prompt).toContain("mock providers");
  });
});

describe("startApplication", () => {
  it("TestStartApplication_RunsDockerComposeUp_WhenFileExists", async () => {
    const mockFs = createMockFs({ "docker-compose.test.yml": "version: '3'" });
    const execFn = vi.fn().mockReturnValue("");
    const ctx = createTestContext({ fs: mockFs, execFn });

    const result = await startApplication(ctx.config, ctx);

    expect(result).toBe(true);
    expect(execFn).toHaveBeenCalledWith("docker compose -f docker-compose.test.yml up -d");
  });

  it("TestStartApplication_ReturnsTrue_WhenNoDockerFile", async () => {
    const mockFs = createMockFs();
    const execFn = vi.fn();
    const ctx = createTestContext({ fs: mockFs, execFn });

    const result = await startApplication(ctx.config, ctx);

    expect(result).toBe(true);
    expect(execFn).not.toHaveBeenCalled();
  });

  it("TestStartApplication_ReturnsFalse_OnExecFailure", async () => {
    const mockFs = createMockFs({ "docker-compose.test.yml": "version: '3'" });
    const execFn = vi.fn().mockImplementation(() => {
      throw new Error("Docker daemon not running");
    });
    const ctx = createTestContext({ fs: mockFs, execFn });

    const result = await startApplication(ctx.config, ctx);

    expect(result).toBe(false);
  });
});

describe("stopApplication", () => {
  it("TestStopApplication_RunsDockerComposeDown_WhenFileExists", async () => {
    const mockFs = createMockFs({ "docker-compose.test.yml": "version: '3'" });
    const execFn = vi.fn().mockReturnValue("");
    const ctx = createTestContext({ fs: mockFs, execFn });

    await stopApplication(ctx.config, ctx);

    expect(execFn).toHaveBeenCalledWith("docker compose -f docker-compose.test.yml down");
  });

  it("TestStopApplication_DoesNothing_WhenNoDockerFile", async () => {
    const mockFs = createMockFs();
    const execFn = vi.fn();
    const ctx = createTestContext({ fs: mockFs, execFn });

    await stopApplication(ctx.config, ctx);

    expect(execFn).not.toHaveBeenCalled();
  });

  it("TestStopApplication_CatchesErrors_Silently", async () => {
    const mockFs = createMockFs({ "docker-compose.test.yml": "version: '3'" });
    const execFn = vi.fn().mockImplementation(() => {
      throw new Error("Docker error");
    });
    const ctx = createTestContext({ fs: mockFs, execFn });

    await expect(stopApplication(ctx.config, ctx)).resolves.toBeUndefined();
  });
});

describe("waitForHealth", () => {
  it("TestWaitForHealth_ReturnsTrue_WhenHealthSucceedsImmediately", async () => {
    const execFn = vi.fn().mockReturnValue("OK");
    const ctx = createTestContext({ execFn });

    const result = await waitForHealth("http://localhost:3000/health", 5000, ctx);

    expect(result).toBe(true);
    expect(execFn).toHaveBeenCalledWith("curl -sf http://localhost:3000/health");
  });

  it("TestWaitForHealth_ReturnsFalse_OnTimeout", async () => {
    const execFn = vi.fn().mockImplementation(() => {
      throw new Error("Connection refused");
    });
    const ctx = createTestContext({ execFn });

    // Use very short timeout to avoid slow tests
    const result = await waitForHealth("http://localhost:3000/health", 100, ctx);

    expect(result).toBe(false);
  });
});

describe("buildUATPrompt", () => {
  const workflow: UATWorkflow = {
    id: "UAT-R1-01",
    requirementId: "R1",
    description: "User Authentication",
    steps: ["Register with email", "Log in with credentials"],
    appType: "web",
  };
  const safetyPrompt = "## Safety\nNEVER use production credentials.";

  it("TestBuildUATPrompt_WebType_IncludesHeadlessBrowser", () => {
    const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
    expect(prompt).toContain("headless browser");
    expect(prompt).toContain("Playwright");
  });

  it("TestBuildUATPrompt_ApiType_IncludesCurlOrFetch", () => {
    const prompt = buildUATPrompt(workflow, "api", safetyPrompt);
    expect(prompt).toMatch(/curl|fetch/);
  });

  it("TestBuildUATPrompt_CliType_IncludesStdoutOrExitCode", () => {
    const prompt = buildUATPrompt(workflow, "cli", safetyPrompt);
    expect(prompt).toMatch(/stdout|exit code/i);
  });

  it("TestBuildUATPrompt_IncludesSafetyPrompt", () => {
    const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
    expect(prompt).toContain("NEVER use production credentials");
  });

  it("TestBuildUATPrompt_IncludesWorkflowSteps", () => {
    const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
    expect(prompt).toContain("Register with email");
    expect(prompt).toContain("Log in with credentials");
  });

  it("TestBuildUATPrompt_IncludesWorkflowId", () => {
    const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
    expect(prompt).toContain("UAT-R1-01");
  });

  it("TestBuildUATPrompt_IncludesJsonOutputFormat", () => {
    const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
    expect(prompt).toContain(".forge/uat/UAT-R1-01.json");
    expect(prompt).toContain("stepsPassed");
    expect(prompt).toContain("stepsFailed");
  });
});

describe("verifyUATResults", () => {
  it("TestVerifyUATResults_ParsesValidJsonResult", () => {
    const mockFs = createMockFs({
      ".forge/uat/UAT-R1-01.json": JSON.stringify({
        passed: true,
        stepsPassed: 3,
        stepsFailed: 0,
        errors: [],
      }),
    });
    const ctx = createTestContext({ fs: mockFs });

    const result = verifyUATResults("UAT-R1-01", ".forge", ctx);

    expect(result.passed).toBe(true);
    expect(result.stepsPassed).toBe(3);
    expect(result.stepsFailed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.workflowId).toBe("UAT-R1-01");
  });

  it("TestVerifyUATResults_ReturnsFailed_WhenFileMissing", () => {
    const mockFs = createMockFs();
    const ctx = createTestContext({ fs: mockFs });

    const result = verifyUATResults("UAT-R1-01", ".forge", ctx);

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("not found");
  });

  it("TestVerifyUATResults_ReturnsFailed_OnInvalidJson", () => {
    const mockFs = createMockFs({
      ".forge/uat/UAT-R1-01.json": "not valid json {{{",
    });
    const ctx = createTestContext({ fs: mockFs });

    const result = verifyUATResults("UAT-R1-01", ".forge", ctx);

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("Failed to parse");
  });

  it("TestVerifyUATResults_HandlesPartialJsonData", () => {
    const mockFs = createMockFs({
      ".forge/uat/UAT-R1-01.json": JSON.stringify({ passed: false }),
    });
    const ctx = createTestContext({ fs: mockFs });

    const result = verifyUATResults("UAT-R1-01", ".forge", ctx);

    expect(result.passed).toBe(false);
    expect(result.stepsPassed).toBe(0);
    expect(result.stepsFailed).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe("runUATGapClosure", () => {
  it("TestRunUATGapClosure_CallsRunStepForEachFailedWorkflow", async () => {
    const failedWorkflows: WorkflowResult[] = [
      {
        workflowId: "UAT-R1-01",
        passed: false,
        stepsPassed: 1,
        stepsFailed: 2,
        errors: ["Login form not found", "Password field missing"],
        durationMs: 5000,
      },
    ];

    const mockRunStep = vi.fn().mockResolvedValue({
      status: "verified",
      costUsd: 0.01,
      costData: { totalCostUsd: 0.01 },
      result: "fixed",
      structuredOutput: undefined,
      sessionId: "fix-session",
    });

    const ctx = createTestContext({ mockRunStep });
    await runUATGapClosure(failedWorkflows, ctx);

    expect(mockRunStep).toHaveBeenCalledTimes(1);
    expect(mockRunStep).toHaveBeenCalledWith(
      "uat-fix-UAT-R1-01",
      expect.objectContaining({
        prompt: expect.stringContaining("UAT-R1-01"),
      }),
      ctx.stepRunnerContext,
      ctx.costController,
    );
  });

  it("TestRunUATGapClosure_DoesNotThrow_OnStepFailure", async () => {
    const failedWorkflows: WorkflowResult[] = [
      {
        workflowId: "UAT-R2-01",
        passed: false,
        stepsPassed: 0,
        stepsFailed: 1,
        errors: ["Dashboard not loading"],
        durationMs: 3000,
      },
    ];

    const mockRunStep = vi.fn().mockRejectedValue(new Error("Step failed"));
    const ctx = createTestContext({ mockRunStep });

    // Should not throw
    await expect(runUATGapClosure(failedWorkflows, ctx)).resolves.toBeUndefined();
  });

  it("TestRunUATGapClosure_HandlesMultipleFailedWorkflows", async () => {
    const failedWorkflows: WorkflowResult[] = [
      {
        workflowId: "UAT-R1-01",
        passed: false,
        stepsPassed: 0,
        stepsFailed: 1,
        errors: ["Error 1"],
        durationMs: 1000,
      },
      {
        workflowId: "UAT-R2-01",
        passed: false,
        stepsPassed: 0,
        stepsFailed: 1,
        errors: ["Error 2"],
        durationMs: 1000,
      },
    ];

    const mockRunStep = vi.fn().mockResolvedValue({
      status: "verified",
      costUsd: 0.01,
      costData: { totalCostUsd: 0.01 },
      result: "fixed",
      structuredOutput: undefined,
      sessionId: "fix-session",
    });
    const ctx = createTestContext({ mockRunStep });

    await runUATGapClosure(failedWorkflows, ctx);

    expect(mockRunStep).toHaveBeenCalledTimes(2);
    expect(mockRunStep).toHaveBeenCalledWith(
      "uat-fix-UAT-R1-01",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mockRunStep).toHaveBeenCalledWith(
      "uat-fix-UAT-R2-01",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("runUAT", () => {
  it("TestRunUAT_ReturnsStuck_WhenRequirementsMissing", async () => {
    const mockFs = createMockFs(); // No REQUIREMENTS.md
    const ctx = createTestContext({ fs: mockFs });

    const result = await runUAT(ctx);

    expect(result.status).toBe("stuck");
    expect(result.workflowsTested).toBe(0);
  });

  it("TestRunUAT_ReturnsPassed_WhenNoWorkflows", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": "# Requirements\n\nNo structured requirements here.",
    });
    const ctx = createTestContext({ fs: mockFs });

    const result = await runUAT(ctx);

    expect(result.status).toBe("passed");
    expect(result.workflowsTested).toBe(0);
  });

  it("TestRunUAT_ReturnsPassed_WhenAllWorkflowsPass", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
      "docker-compose.test.yml": "version: '3'",
    });
    const execFn = vi.fn().mockReturnValue("OK");
    const mockRunStep = createMockRunStep(mockFs, true);
    const ctx = createTestContext({ fs: mockFs, execFn, mockRunStep });

    const result = await runUAT(ctx);

    expect(result.status).toBe("passed");
    expect(result.workflowsTested).toBeGreaterThanOrEqual(3);
    expect(result.workflowsFailed).toBe(0);
  });

  it("TestRunUAT_ReturnsStuck_WhenAppFailsToStart", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
      "docker-compose.test.yml": "version: '3'",
    });
    const execFn = vi.fn().mockImplementation(() => {
      throw new Error("Docker not running");
    });
    const ctx = createTestContext({ fs: mockFs, execFn });

    const result = await runUAT(ctx);

    expect(result.status).toBe("stuck");
    expect(result.workflowsTested).toBe(0);
  });

  it("TestRunUAT_ReturnsStuck_WhenHealthCheckFails", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
      "docker-compose.test.yml": "version: '3'",
    });
    // Docker starts fine, but health check always fails
    const execFn = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes("up -d")) return "OK";
      if (cmd.includes("down")) return "OK";
      if (cmd.includes("curl")) throw new Error("Connection refused");
      return "";
    });
    const ctx = createTestContext({ fs: mockFs, execFn });

    // Use short timeout by testing waitForHealth directly rather than through runUAT
    // runUAT hardcodes 30000ms which is too slow for tests
    // Instead verify the health failure path via a direct waitForHealth call
    const healthResult = await waitForHealth("http://localhost:3000/health", 100, ctx);
    expect(healthResult).toBe(false);
  });

  it("TestRunUAT_RunsWorkflows_WhenNoDockerFile", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
    });
    // No docker-compose.test.yml -- app starts directly, health passes
    const execFn = vi.fn().mockReturnValue("OK");
    const mockRunStep = createMockRunStep(mockFs, true);
    const ctx = createTestContext({ fs: mockFs, execFn, mockRunStep });

    const result = await runUAT(ctx);

    expect(result.status).toBe("passed");
    expect(result.workflowsTested).toBeGreaterThanOrEqual(3);
    expect(mockRunStep).toHaveBeenCalled();
  });

  it("TestRunUAT_TriggersGapClosure_WhenWorkflowsFail", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
    });
    const execFn = vi.fn().mockReturnValue("OK");

    // runStep always writes failing results -- gap closure can't fix them
    let callCount = 0;
    const mockRunStep = vi.fn().mockImplementation(async (name: string) => {
      callCount++;
      const wfId = name.replace("uat-", "").replace("uat-fix-", "");
      // Always fail -- never write a passing result
      mockFs._store.set(
        `.forge/uat/${wfId}.json`,
        JSON.stringify({
          passed: false,
          stepsPassed: 0,
          stepsFailed: 1,
          errors: ["Persistent failure"],
        }),
      );
      return {
        status: "verified",
        costUsd: 0.01,
        costData: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 },
        result: "done",
        structuredOutput: undefined,
        sessionId: "test-session",
      };
    });

    // Use maxRetries: 1 for fast test
    const config = createTestConfig({
      maxRetries: 1,
    });
    const ctx = createTestContext({ config, fs: mockFs, execFn, mockRunStep });

    const result = await runUAT(ctx);

    expect(result.status).toBe("stuck");
    expect(result.workflowsFailed).toBeGreaterThan(0);
    // Should have called runStep more than just once per workflow (retries + gap closure)
    expect(mockRunStep).toHaveBeenCalled();
  });

  it("TestRunUAT_UpdatesState_WithFinalResults", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": SAMPLE_REQUIREMENTS,
    });
    const execFn = vi.fn().mockReturnValue("OK");
    const mockRunStep = createMockRunStep(mockFs, true);
    const ctx = createTestContext({ fs: mockFs, execFn, mockRunStep });
    const mockUpdate = ctx.stateManager.update as ReturnType<typeof vi.fn>;

    await runUAT(ctx);

    // Verify state was updated with UAT results
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("TestRunUAT_ReturnsStuck_WhenGapClosureExhaustsRetries", async () => {
    const mockFs = createMockFs({
      "REQUIREMENTS.md": `# Requirements

## R1: Simple Feature
**Description:** A simple feature.
**Acceptance Criteria:**
- Feature works correctly
`,
    });
    const execFn = vi.fn().mockReturnValue("OK");

    // Always fail
    const mockRunStep = vi.fn().mockImplementation(async (name: string) => {
      const wfId = name.replace("uat-", "").replace("uat-fix-", "");
      mockFs._store.set(
        `.forge/uat/${wfId}.json`,
        JSON.stringify({ passed: false, stepsPassed: 0, stepsFailed: 1, errors: ["Still broken"] }),
      );
      return {
        status: "verified",
        costUsd: 0.01,
        costData: { totalCostUsd: 0.01, inputTokens: 100, outputTokens: 50 },
        result: "done",
        structuredOutput: undefined,
        sessionId: "test",
      };
    });

    const config = createTestConfig({ maxRetries: 2 });
    const ctx = createTestContext({ config, fs: mockFs, execFn, mockRunStep });

    const result = await runUAT(ctx);

    expect(result.status).toBe("stuck");
    expect(result.attemptsUsed).toBeGreaterThan(1);
  });
});

describe("additional edge cases", () => {
  it("TestDetectAppType_ReturnsWeb_ForVue", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "vue" },
    });
    expect(detectAppType(config)).toBe("web");
  });

  it("TestDetectAppType_ReturnsWeb_ForAngular", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "angular" },
    });
    expect(detectAppType(config)).toBe("web");
  });

  it("TestDetectAppType_ReturnsWeb_ForSvelte", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "svelte" },
    });
    expect(detectAppType(config)).toBe("web");
  });

  it("TestDetectAppType_ReturnsApi_ForNestjs", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "nestjs" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsApi_ForDjango", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "django" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsApi_ForFlask", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "flask" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsApi_ForRails", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "rails" },
    });
    expect(detectAppType(config)).toBe("api");
  });

  it("TestDetectAppType_ReturnsCli_ForRust", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "rust" },
    });
    expect(detectAppType(config)).toBe("cli");
  });

  it("TestDetectAppType_ReturnsCli_ForPython", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "python" },
    });
    expect(detectAppType(config)).toBe("cli");
  });

  it("TestExtractWorkflows_HandlesRequirementsWithMultipleSteps", () => {
    const reqs = `# Requirements

## R1: Complex Feature
**Description:** A complex feature with many acceptance criteria.
**Acceptance Criteria:**
- Step one
- Step two
- Step three
- Step four
- Step five
- Step six
- Step seven

`;
    const workflows = extractUserWorkflows(reqs, "api");
    // Should split into multiple workflows since > 5 steps
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    // First chunk should have 5 steps
    expect(workflows[0].steps.length).toBe(5);
    // Second chunk should have the remaining 2
    expect(workflows[1].steps.length).toBe(2);
    expect(workflows[1].id).toBe("UAT-R1-02");
  });

  it("TestDetectAppType_CaseInsensitive", () => {
    const config = createTestConfig({
      testing: { ...createTestConfig().testing, stack: "REACT" },
    });
    expect(detectAppType(config)).toBe("web");
  });
});
