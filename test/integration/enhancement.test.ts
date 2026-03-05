/**
 * Enhancement Layer Integration Tests
 *
 * Tests that verify multi-module interactions between the three Phase 8
 * modules (requirements, docs, UAT) with mocked SDK. Uses vi.fn() for
 * executeQuery, Map-based in-memory fs, and real module imports.
 *
 * Requirement coverage:
 * REQ-01: TestRequirementsIntegration_GatherParseFormatRoundTrip
 * REQ-02: TestRequirementsIntegration_ComplianceFlagsFlowThrough
 * REQ-03: TestRequirementsIntegration_MissingFieldsHandledGracefully
 * REQ-04: TestRequirementsIntegration_MultipleCategoriesParsedAndFormatted
 * DOC-01: TestNotionIntegration_CreatePagesReturnsAllIds
 * DOC-02: TestNotionIntegration_CreateThenUpdateFlow
 * DOC-03: TestNotionIntegration_PublishFinalDocsUpdatesAllPages
 * DOC-04: TestNotionIntegration_FailureInOneUpdateDoesntPreventOthers
 * UAT-01: TestUATIntegration_ExtractBuildVerifyFlow
 * UAT-02: TestUATIntegration_RunUATAllWorkflowsPass
 * UAT-03: TestUATIntegration_RunUATSomeWorkflowsFailGapClosure
 * UAT-04: TestUATIntegration_SafetyPromptAlwaysIncluded
 * UAT-05: TestUATIntegration_DockerLifecycleCalledInOrder
 * UAT-06: TestUATIntegration_GapClosureTriggeredOnFailure
 * Cross-module: TestCrossModule_RequirementsOutputFeedsUATWorkflows,
 *               TestCrossModule_PhaseReportFeedsNotionUpdate
 */

import { describe, it, expect, vi } from "vitest";

// Requirements module
import {
  gatherRequirements,
  buildRequirementsPrompt,
  parseRequirementsOutput,
  detectComplianceFlags,
  formatRequirementsDoc,
} from "../../src/requirements/index.js";
import type { GatherResult, Requirement } from "../../src/requirements/types.js";

// Docs module
import {
  createDocPages,
  updateArchitecture,
  createPhaseReport,
  publishFinalDocs,
  buildPageUpdatePrompt,
} from "../../src/docs/index.js";
import type {
  NotionPageIds,
  PhaseReport,
  MilestoneSummary,
  ExecuteQueryFn,
} from "../../src/docs/types.js";

// UAT module
import {
  extractUserWorkflows,
  buildSafetyPrompt,
  runUATGapClosure,
  runUAT,
  detectAppType,
  buildUATPrompt,
  verifyUATResults,
} from "../../src/uat/index.js";
import type { UATContext, UATWorkflow, SafetyConfig } from "../../src/uat/types.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import type { ForgeState } from "../../src/state/schema.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Sample requirements markdown output matching the parser's expected format */
const SAMPLE_REQUIREMENTS_MARKDOWN = `
## R1: User Authentication

**Category:** Security
**Description:** Users must authenticate with email and password. SOC 2 audit logging required.
**Acceptance Criteria:**
- Users can register with email and password
- Users can log in with valid credentials
- Users receive error on invalid credentials
- Session tokens expire after 24 hours
**Edge Cases:**
- Concurrent login attempts from same account
- Expired tokens must be rejected
**Performance:** Login response under 200ms
**Security:** All passwords hashed with bcrypt, audit log for all auth events

## R2: Data Export

**Category:** Data
**Description:** Users can export their data in CSV format. GDPR right to erasure compliance.
**Acceptance Criteria:**
- Export includes all user data
- CSV format is valid and parseable
- Export completes within 30 seconds for typical datasets
**Edge Cases:**
- Empty dataset produces valid CSV with headers only
**Performance:** Export under 30s for 100K records

## R3: API Rate Limiting

**Category:** Quality
**Description:** API endpoints must enforce rate limits per user.
**Acceptance Criteria:**
- 100 requests per minute per user
- Rate-limited responses return 429 status
- Rate limit headers included in all responses
**Edge Cases:**
- Burst traffic from single user
`;

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    model: "claude-opus-4-6",
    maxBudgetTotal: 200,
    maxBudgetPerStep: 15,
    maxRetries: 2,
    maxComplianceRounds: 3,
    maxTurnsPerStep: 200,
    testing: {
      stack: "express",
      unitCommand: "npm test -- --json",
      integrationCommand: "npm run test:integration -- --json",
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

function makeState(overrides: Partial<ForgeState> = {}): ForgeState {
  return {
    projectDir: "/test/project",
    startedAt: "2026-01-01T00:00:00Z",
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "initializing",
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {},
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
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 0,
    ...overrides,
  };
}

/** Create mock executeQuery that returns sample requirements markdown */
function createMockExecuteQuery(
  response?: Partial<{ ok: boolean; result: string; structuredOutput: unknown; error: { message: string } }>,
): ExecuteQueryFn {
  return vi.fn().mockResolvedValue({
    ok: true,
    result: SAMPLE_REQUIREMENTS_MARKDOWN,
    structuredOutput: null,
    ...response,
  });
}

/** Create mock page IDs for Notion tests */
function createMockPageIds(): NotionPageIds {
  return {
    architecture: "page-arch-001",
    dataFlow: "page-df-002",
    apiReference: "page-api-003",
    componentIndex: "page-comp-004",
    adrs: "page-adrs-005",
    deployment: "page-deploy-006",
    devWorkflow: "page-dev-007",
    phaseReports: "page-reports-008",
  };
}

/** Create a mock phase report */
function createMockPhaseReport(): PhaseReport {
  return {
    phaseNumber: 3,
    phaseName: "Business Logic",
    goals: "Implement core business rules and validation",
    testResults: { passed: 45, failed: 2, total: 47 },
    architectureChanges: ["Added service layer", "Introduced event bus"],
    issues: ["Rate limiter needed tuning"],
    budgetUsed: 12.5,
  };
}

/** Create a UATContext with in-memory mocks */
function createMockUATContext(options: {
  requirementsContent?: string;
  dockerComposeExists?: boolean;
  runStepBehavior?: (name: string, opts: any, ctx: any, cc: any) => Promise<any>;
  config?: Partial<ForgeConfig>;
  stateOverrides?: Partial<ForgeState>;
} = {}): {
  ctx: UATContext;
  getState: () => ForgeState;
  files: Map<string, string>;
  execCalls: string[];
} {
  const config = makeConfig(options.config);
  let currentState = makeState(options.stateOverrides);
  const files = new Map<string, string>();
  const execCalls: string[] = [];

  // Set up REQUIREMENTS.md
  if (options.requirementsContent !== undefined) {
    files.set("REQUIREMENTS.md", options.requirementsContent);
  } else {
    files.set("REQUIREMENTS.md", SAMPLE_REQUIREMENTS_MARKDOWN);
  }

  // Optionally set docker-compose
  if (options.dockerComposeExists) {
    files.set(config.testing.dockerComposeFile, "version: '3'");
  }

  const stateManager = {
    load: () => currentState,
    update: async (
      updater: (state: ForgeState) => ForgeState,
    ): Promise<ForgeState> => {
      currentState = updater(currentState);
      return currentState;
    },
    exists: () => true,
    save: (s: ForgeState) => { currentState = s; },
  } as any;

  const mockFs = {
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string, _enc: string) => {
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    },
    writeFileSync: (p: string, content: string) => {
      files.set(p, content);
    },
    mkdirSync: () => {},
  };

  const mockExecFn = (cmd: string): string => {
    execCalls.push(cmd);
    if (cmd.includes("curl")) return "OK";
    if (cmd.includes("docker compose")) return "";
    return "";
  };

  const defaultRunStep = async (name: string, opts: any, _ctx: any, _cc: any) => {
    // Write a passing UAT result file for workflow steps
    if (name.startsWith("uat-UAT-")) {
      const workflowId = name.replace("uat-", "");
      files.set(
        `.forge/uat/${workflowId}.json`,
        JSON.stringify({ passed: true, stepsPassed: 1, stepsFailed: 0, errors: [] }),
      );
    }
    return { status: "verified", costUsd: 0.01, costData: { totalCostUsd: 0.01 }, result: "done", structuredOutput: null, sessionId: "mock" };
  };

  const runStepFn = options.runStepBehavior ?? defaultRunStep;

  const stepRunnerContext = {
    config,
    stateManager,
    executeQueryFn: vi.fn().mockResolvedValue({ ok: true, result: "done" }),
  } as any;

  const costController = {
    checkBudget: () => {},
    recordStepCost: () => {},
    getTotal: () => 0,
  } as any;

  const ctx: UATContext = {
    config,
    stateManager,
    stepRunnerContext,
    costController,
    fs: mockFs,
    execFn: mockExecFn,
    runStepFn,
  };

  return { ctx, getState: () => currentState, files, execCalls };
}

// ============================================================================
// Requirements gathering integration (REQ-01, REQ-02, REQ-03, REQ-04)
// ============================================================================

describe("Requirements Integration: Gather -> Parse -> Format", () => {
  /**
   * REQ-01: End-to-end gather -> parse -> detect -> format with mocked SDK
   */
  it("TestRequirementsIntegration_GatherParseFormatRoundTrip", async () => {
    const mockQuery = createMockExecuteQuery();
    const config = makeConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as any,
      projectName: "TestProject",
    });

    // Verify GatherResult structure
    expect(result.requirements.length).toBeGreaterThanOrEqual(3);
    expect(result.rawOutput).toBe(SAMPLE_REQUIREMENTS_MARKDOWN);
    expect(result.formattedDoc).toContain("# Requirements");
    expect(result.formattedDoc).toContain("## R1:");
    expect(result.formattedDoc).toContain("## R2:");
    expect(result.formattedDoc).toContain("## R3:");

    // Round-trip: re-parse the formatted output
    const reparsed = parseRequirementsOutput(result.formattedDoc);
    expect(reparsed.length).toBe(result.requirements.length);
    for (let i = 0; i < reparsed.length; i++) {
      expect(reparsed[i].id).toBe(result.requirements[i].id);
      expect(reparsed[i].title).toBe(result.requirements[i].title);
      expect(reparsed[i].category).toBe(result.requirements[i].category);
    }

    // Verify mock was called with correct parameters
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain("TestProject");
    expect(callArgs.model).toBe("claude-opus-4-6");
  });

  /**
   * REQ-02: Compliance flags flow from gathering through to structured output
   */
  it("TestRequirementsIntegration_ComplianceFlagsFlowThrough", async () => {
    const mockQuery = createMockExecuteQuery();
    const config = makeConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as any,
    });

    // R1 mentions SOC 2 and audit log
    expect(result.complianceFlags.soc2).toBe(true);
    // R2 mentions GDPR
    expect(result.complianceFlags.gdpr).toBe(true);
    // No HIPAA, PCI, or WCAG keywords
    expect(result.complianceFlags.hipaa).toBe(false);
    expect(result.complianceFlags.pciDss).toBe(false);
    expect(result.complianceFlags.wcag).toBe(false);

    // Formatted doc should include compliance section
    expect(result.formattedDoc).toContain("## Compliance");
    expect(result.formattedDoc).toContain("SOC 2");
    expect(result.formattedDoc).toContain("GDPR");
  });

  /**
   * REQ-03: Requirements with missing fields are handled gracefully
   */
  it("TestRequirementsIntegration_MissingFieldsHandledGracefully", async () => {
    const sparseMarkdown = `
## R1: Minimal Requirement

**Category:** Core
**Description:** A requirement with minimal fields
**Acceptance Criteria:**
- It works
`;
    const mockQuery = createMockExecuteQuery({ result: sparseMarkdown });
    const config = makeConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as any,
    });

    expect(result.requirements).toHaveLength(1);
    const req = result.requirements[0];
    expect(req.id).toBe("R1");
    expect(req.title).toBe("Minimal Requirement");
    expect(req.description).toBe("A requirement with minimal fields");
    expect(req.acceptanceCriteria).toEqual(["It works"]);
    expect(req.edgeCases).toEqual([]);
    expect(req.performance).toBeUndefined();
    expect(req.security).toBeUndefined();
    expect(req.observability).toBeUndefined();
  });

  /**
   * REQ-04: Multiple requirements across different categories are parsed and formatted
   */
  it("TestRequirementsIntegration_MultipleCategoriesParsedAndFormatted", async () => {
    const mockQuery = createMockExecuteQuery();
    const config = makeConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as any,
    });

    // Should have requirements from different categories
    const categories = new Set(result.requirements.map((r) => r.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
    expect(categories).toContain("Security"); // R1
    expect(categories).toContain("Data"); // R2
    expect(categories).toContain("Quality"); // R3

    // Formatted doc contains all categories
    for (const cat of categories) {
      expect(result.formattedDoc).toContain(`**Category:** ${cat}`);
    }
  });
});

// ============================================================================
// Notion documentation integration (DOC-01, DOC-02, DOC-03, DOC-04)
// ============================================================================

describe("Notion Integration: Page Lifecycle", () => {
  /**
   * DOC-01: createDocPages returns all 8 page IDs
   */
  it("TestNotionIntegration_CreatePagesReturnsAllIds", async () => {
    const mockPageIds = createMockPageIds();
    const mockQuery: ExecuteQueryFn = vi.fn().mockResolvedValue({
      ok: true,
      result: "Pages created",
      structuredOutput: mockPageIds,
    });

    const result = await createDocPages("parent-123", "TestProject", {
      executeQueryFn: mockQuery,
    });

    expect(result).toEqual(mockPageIds);
    expect(Object.keys(result)).toHaveLength(8);

    // Verify the prompt mentions all mandatory pages
    const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.prompt).toContain("parent-123");
    expect(callArgs.prompt).toContain("TestProject");
    expect(callArgs.prompt).toContain("Architecture");
    expect(callArgs.prompt).toContain("Phase Reports");
  });

  /**
   * DOC-02: createDocPages -> updateArchitecture -> createPhaseReport flow
   */
  it("TestNotionIntegration_CreateThenUpdateFlow", async () => {
    const queryCalls: string[] = [];
    const mockQuery: ExecuteQueryFn = vi.fn().mockImplementation(async (opts) => {
      queryCalls.push(opts.prompt);
      if (opts.outputSchema) {
        return { ok: true, result: "Created", structuredOutput: createMockPageIds() };
      }
      return { ok: true, result: "Updated" };
    });

    // Step 1: Create pages
    const pageIds = await createDocPages("parent-123", "TestProject", {
      executeQueryFn: mockQuery,
    });

    // Step 2: Update architecture page with phase report data
    const report = createMockPhaseReport();
    await updateArchitecture(pageIds.architecture, report, {
      executeQueryFn: mockQuery,
    });

    // Step 3: Create phase report page
    const reportPageId = await createPhaseReport(pageIds.phaseReports, report, {
      executeQueryFn: mockQuery,
    });

    // Verify the flow: create -> update -> create
    expect(queryCalls).toHaveLength(3);
    expect(queryCalls[0]).toContain("parent-123"); // Create
    expect(queryCalls[1]).toContain(pageIds.architecture); // Update
    expect(queryCalls[2]).toContain(pageIds.phaseReports); // Phase report
    expect(typeof reportPageId).toBe("string");
  });

  /**
   * DOC-04: publishFinalDocs updates all 8 pages + creates milestone summary
   */
  it("TestNotionIntegration_PublishFinalDocsUpdatesAllPages", async () => {
    const pageIds = createMockPageIds();
    const queryCalls: string[] = [];
    const mockQuery: ExecuteQueryFn = vi.fn().mockImplementation(async (opts) => {
      queryCalls.push(opts.prompt);
      return { ok: true, result: "Done" };
    });

    const summary: MilestoneSummary = {
      totalPhases: 8,
      totalTests: 350,
      totalBudget: 45.0,
      requirements: { total: 25, verified: 25 },
      highlights: ["Full coverage", "All requirements met"],
    };

    await publishFinalDocs(pageIds, summary, { executeQueryFn: mockQuery });

    // 8 page updates + 1 milestone summary creation = 9 calls
    expect(queryCalls).toHaveLength(9);

    // Each page ID should appear in at least one call
    for (const [, pageId] of Object.entries(pageIds)) {
      const found = queryCalls.some((c) => c.includes(pageId));
      expect(found).toBe(true);
    }

    // Milestone summary call mentions phaseReports page
    const milestoneCalls = queryCalls.filter((c) =>
      c.includes("Milestone Complete"),
    );
    expect(milestoneCalls).toHaveLength(1);
    expect(milestoneCalls[0]).toContain(pageIds.phaseReports);
  });

  /**
   * DOC-03: Failure in one page update doesn't prevent others
   */
  it("TestNotionIntegration_FailureInOneUpdateDoesntPreventOthers", async () => {
    const pageIds = createMockPageIds();
    let callCount = 0;
    const mockQuery: ExecuteQueryFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 3) {
        // Third call fails
        return { ok: false, error: { message: "Network timeout" } };
      }
      return { ok: true, result: "Done" };
    });

    const summary: MilestoneSummary = {
      totalPhases: 5,
      totalTests: 100,
      totalBudget: 20.0,
      requirements: { total: 10, verified: 10 },
      highlights: ["Done"],
    };

    // Should not throw despite one failure
    await publishFinalDocs(pageIds, summary, { executeQueryFn: mockQuery });

    // All 9 calls should have been attempted despite the failure
    expect(callCount).toBe(9);
  });
});

// ============================================================================
// UAT runner integration (UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06)
// ============================================================================

describe("UAT Integration: Runner Lifecycle", () => {
  /**
   * UAT-01: extractUserWorkflows -> buildUATPrompt -> verifyUATResults flow
   */
  it("TestUATIntegration_ExtractBuildVerifyFlow", () => {
    // Extract workflows from requirements
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS_MARKDOWN, "api");
    expect(workflows.length).toBeGreaterThanOrEqual(3);

    // Build prompt for first workflow
    const safetyConfig: SafetyConfig = {
      useSandboxCredentials: true,
      useLocalSmtp: true,
      useTestDb: true,
      envFile: ".env.test",
    };
    const safetyPrompt = buildSafetyPrompt(safetyConfig);
    const prompt = buildUATPrompt(workflows[0], "api", safetyPrompt);

    expect(prompt).toContain("UAT Test:");
    expect(prompt).toContain(workflows[0].id);
    expect(prompt).toContain("curl or fetch");
    expect(prompt).toContain("Safety Guardrails");

    // Verify results with mock filesystem
    const files = new Map<string, string>();
    files.set(
      `.forge/uat/${workflows[0].id}.json`,
      JSON.stringify({ passed: true, stepsPassed: 4, stepsFailed: 0, errors: [] }),
    );

    const mockCtx = {
      config: makeConfig(),
      stateManager: {} as any,
      stepRunnerContext: {} as any,
      costController: {} as any,
      fs: {
        existsSync: (p: string) => files.has(p),
        readFileSync: (p: string, _enc: string) => files.get(p) ?? "",
        writeFileSync: () => {},
        mkdirSync: () => {},
      },
    } as UATContext;

    const result = verifyUATResults(workflows[0].id, ".forge", mockCtx);
    expect(result.passed).toBe(true);
    expect(result.stepsPassed).toBe(4);
    expect(result.stepsFailed).toBe(0);
  });

  /**
   * UAT-02: runUAT with mocked step runner -- all workflows pass -> "passed"
   */
  it("TestUATIntegration_RunUATAllWorkflowsPass", async () => {
    const { ctx } = createMockUATContext();

    const result = await runUAT(ctx);

    expect(result.status).toBe("passed");
    expect(result.workflowsTested).toBeGreaterThanOrEqual(3);
    expect(result.workflowsPassed).toBe(result.workflowsTested);
    expect(result.workflowsFailed).toBe(0);
    expect(result.attemptsUsed).toBe(1);
  });

  /**
   * UAT-03, UAT-06: runUAT with some workflows failing -> gap closure triggered
   */
  it("TestUATIntegration_RunUATSomeWorkflowsFailGapClosure", async () => {
    let callCount = 0;
    const gapClosureCalls: string[] = [];

    const { ctx, files } = createMockUATContext({
      config: { maxRetries: 1 },
      runStepBehavior: async (name, opts, _ctx, _cc) => {
        callCount++;
        if (name.startsWith("uat-UAT-")) {
          const workflowId = name.replace("uat-", "");
          // First attempt: R1 fails, others pass
          if (workflowId.includes("R1") && callCount <= 3) {
            files.set(
              `.forge/uat/${workflowId}.json`,
              JSON.stringify({ passed: false, stepsPassed: 2, stepsFailed: 2, errors: ["Auth failed"] }),
            );
          } else {
            files.set(
              `.forge/uat/${workflowId}.json`,
              JSON.stringify({ passed: true, stepsPassed: 1, stepsFailed: 0, errors: [] }),
            );
          }
        }
        if (name.startsWith("uat-fix-")) {
          gapClosureCalls.push(name);
        }
        return { status: "verified", costUsd: 0.01, costData: { totalCostUsd: 0.01 }, result: "done", structuredOutput: null, sessionId: "mock" };
      },
    });

    const result = await runUAT(ctx);

    // Gap closure should have been triggered for the failed R1 workflow
    expect(gapClosureCalls.length).toBeGreaterThan(0);
    // After gap closure and retry, R1 should pass on second attempt
    expect(result.status).toBe("passed");
    expect(result.attemptsUsed).toBe(2);
  });

  /**
   * UAT-04: Safety prompt is always included in UAT prompts
   */
  it("TestUATIntegration_SafetyPromptAlwaysIncluded", () => {
    const workflows = extractUserWorkflows(SAMPLE_REQUIREMENTS_MARKDOWN, "web");

    const safetyConfig: SafetyConfig = {
      useSandboxCredentials: true,
      useLocalSmtp: true,
      useTestDb: true,
      envFile: ".env.test",
    };
    const safetyPrompt = buildSafetyPrompt(safetyConfig);

    for (const workflow of workflows) {
      const prompt = buildUATPrompt(workflow, "web", safetyPrompt);
      expect(prompt).toContain("Safety Guardrails");
      expect(prompt).toContain("NEVER use production credentials");
      expect(prompt).toContain("local SMTP");
      expect(prompt).toContain("test database");
      expect(prompt).toContain(".env.test");
    }
  });

  /**
   * UAT-05: Docker lifecycle (start/health/stop) called in correct order
   */
  it("TestUATIntegration_DockerLifecycleCalledInOrder", async () => {
    const { ctx, execCalls } = createMockUATContext({
      dockerComposeExists: true,
    });

    await runUAT(ctx);

    // Docker compose up should be called before curl health check
    const dockerUpIdx = execCalls.findIndex((c) => c.includes("docker compose") && c.includes("up"));
    const healthIdx = execCalls.findIndex((c) => c.includes("curl"));
    const dockerDownIdx = execCalls.findIndex((c) => c.includes("docker compose") && c.includes("down"));

    expect(dockerUpIdx).toBeGreaterThanOrEqual(0);
    expect(healthIdx).toBeGreaterThan(dockerUpIdx);
    expect(dockerDownIdx).toBeGreaterThan(healthIdx);
  });

  /**
   * UAT-06: Gap closure triggered on failure and retries failed workflows
   */
  it("TestUATIntegration_GapClosureTriggeredOnFailure", async () => {
    const gapClosureCalls: string[] = [];

    const { ctx, files } = createMockUATContext({
      config: { maxRetries: 1 },
      runStepBehavior: async (name, _opts, _ctx, _cc) => {
        if (name.startsWith("uat-fix-")) {
          gapClosureCalls.push(name);
        }
        if (name.startsWith("uat-UAT-")) {
          const workflowId = name.replace("uat-", "");
          // All workflows fail on first attempt, pass on second
          if (gapClosureCalls.length === 0) {
            files.set(
              `.forge/uat/${workflowId}.json`,
              JSON.stringify({ passed: false, stepsPassed: 0, stepsFailed: 1, errors: ["Not implemented"] }),
            );
          } else {
            files.set(
              `.forge/uat/${workflowId}.json`,
              JSON.stringify({ passed: true, stepsPassed: 1, stepsFailed: 0, errors: [] }),
            );
          }
        }
        return { status: "verified", costUsd: 0.01, costData: { totalCostUsd: 0.01 }, result: "done", structuredOutput: null, sessionId: "mock" };
      },
    });

    const result = await runUAT(ctx);

    expect(gapClosureCalls.length).toBeGreaterThan(0);
    expect(result.status).toBe("passed");
    expect(result.attemptsUsed).toBe(2);
  });
});

// ============================================================================
// Cross-module integration
// ============================================================================

describe("Cross-Module Integration", () => {
  /**
   * Requirements output feeds into UAT workflow extraction
   */
  it("TestCrossModule_RequirementsOutputFeedsUATWorkflows", async () => {
    // Step 1: Gather requirements
    const mockQuery = createMockExecuteQuery();
    const config = makeConfig();
    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as any,
    });

    // Step 2: Format as REQUIREMENTS.md
    const formattedDoc = result.formattedDoc;
    expect(formattedDoc).toContain("## R1:");

    // Step 3: Extract UAT workflows from the formatted document
    const workflows = extractUserWorkflows(formattedDoc, "api");
    expect(workflows.length).toBeGreaterThanOrEqual(3);

    // Each workflow should reference a requirement ID from the gathered results
    const reqIds = new Set(result.requirements.map((r) => r.id));
    for (const wf of workflows) {
      expect(reqIds.has(wf.requirementId)).toBe(true);
    }

    // Workflow steps should come from acceptance criteria
    const r1Workflow = workflows.find((w) => w.requirementId === "R1");
    expect(r1Workflow).toBeDefined();
    if (r1Workflow) {
      expect(r1Workflow.steps.length).toBeGreaterThan(0);
      expect(r1Workflow.steps[0]).toContain("register");
    }
  });

  /**
   * Phase report data feeds into Notion page updates
   */
  it("TestCrossModule_PhaseReportFeedsNotionUpdate", async () => {
    const queryCalls: Array<{ prompt: string }> = [];
    const mockQuery: ExecuteQueryFn = vi.fn().mockImplementation(async (opts) => {
      queryCalls.push({ prompt: opts.prompt });
      return { ok: true, result: "Updated" };
    });

    const pageIds = createMockPageIds();
    const report = createMockPhaseReport();

    // Update architecture page with phase report
    await updateArchitecture(pageIds.architecture, report, {
      executeQueryFn: mockQuery,
    });

    // Verify the update prompt contains report data
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].prompt).toContain(pageIds.architecture);
    expect(queryCalls[0].prompt).toContain("Phase 3");
    expect(queryCalls[0].prompt).toContain("Business Logic");
    expect(queryCalls[0].prompt).toContain("Added service layer");
  });
});
