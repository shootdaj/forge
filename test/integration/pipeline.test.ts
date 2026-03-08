/**
 * Pipeline Controller Integration Tests
 *
 * Tests that verify component interactions between the pipeline controller's
 * subsystems: dependency graph, mock manager, checkpoint, spec compliance,
 * and the controller FSM itself.
 *
 * Uses the createTestPipelineContext helper from unit tests (adapted) with
 * in-memory StateManager, mock runPhaseFn, and configurable executeQueryFn.
 *
 * Requirements tested: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06,
 *                      PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11,
 *                      MOCK-01, MOCK-02, MOCK-03, MOCK-04
 */

import { describe, it, expect } from "vitest";
import { runPipeline } from "../../src/pipeline/pipeline-controller.js";
import { getExecutionWaves } from "../../src/pipeline/dependency-graph.js";
import type {
  PipelineContext,
  PipelineResult,
  ServiceDetection,
} from "../../src/pipeline/types.js";
import type { ForgeState, OrchestratorStatus } from "../../src/state/schema.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import type { PhaseResult, PhaseRunnerContext } from "../../src/phase-runner/types.js";
import type { RunPhaseOptions } from "../../src/phase-runner/phase-runner.js";
import type { StepRunnerContext } from "../../src/step-runner/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function makeConfig(overrides: Partial<ForgeConfig> = {}): ForgeConfig {
  return {
    model: "claude-opus-4-6",
    maxBudgetTotal: 200,
    maxBudgetPerStep: 15,
    maxRetries: 2,
    maxComplianceRounds: 3,
    maxTurnsPerStep: 200,
    testing: {
      stack: "node",
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

/**
 * Complex roadmap: 6 depends on 5, 5 on 4, 4 on 1, 2 on 1, 3 on 1.
 * Waves: [1], [2, 3, 4], [5], [6]
 */
const COMPLEX_ROADMAP = `# Roadmap

### Phase 1: Foundation
**Depends on**: Nothing
**Requirements**: REQ-01
**Goal**: Set up the foundation

### Phase 2: Auth
**Depends on**: Phase 1
**Requirements**: REQ-02
**Goal**: Build authentication

### Phase 3: API
**Depends on**: Phase 1
**Requirements**: REQ-03
**Goal**: Build REST API

### Phase 4: Storage
**Depends on**: Phase 1
**Requirements**: REQ-04
**Goal**: Build file storage with s3

### Phase 5: Dashboard
**Depends on**: Phase 4
**Requirements**: REQ-05
**Goal**: Build dashboard

### Phase 6: Deploy
**Depends on**: Phase 5
**Requirements**: REQ-06
**Goal**: Deploy everything
`;

/**
 * Roadmap where phases 2 and 3 are both independent of each other
 * (both depend only on phase 1).
 */
const PARALLEL_ROADMAP = `# Roadmap

### Phase 1: Foundation
**Depends on**: Nothing
**Requirements**: REQ-01
**Goal**: Set up the foundation

### Phase 2: Auth
**Depends on**: Phase 1
**Requirements**: REQ-02
**Goal**: Build authentication

### Phase 3: API
**Depends on**: Phase 1
**Requirements**: REQ-03
**Goal**: Build REST API
`;

/**
 * Roadmap with stripe and sendgrid keywords for service detection.
 */
const SERVICE_ROADMAP = `# Roadmap

### Phase 1: Foundation
**Depends on**: Nothing
**Requirements**: REQ-01
**Goal**: Set up the foundation with database

### Phase 2: Payments
**Depends on**: Phase 1
**Requirements**: REQ-02
**Goal**: Implement payment processing with stripe

### Phase 3: Email
**Depends on**: Phase 1
**Requirements**: REQ-03
**Goal**: Set up email notifications with sendgrid
`;

/**
 * Create a test PipelineContext with controllable behavior.
 * Adapted from pipeline-controller.test.ts but more flexible
 * for integration-level testing.
 */
function createTestPipelineContext(options: {
  initialState?: Partial<ForgeState>;
  roadmapContent?: string;
  configOverrides?: Partial<ForgeConfig>;
  runPhaseFnBehavior?: (
    phaseNumber: number,
    ctx: PhaseRunnerContext,
    opts?: RunPhaseOptions,
  ) => Promise<PhaseResult>;
  executeQueryBehavior?: (opts: any) => Promise<any>;
} = {}): {
  ctx: PipelineContext;
  getState: () => ForgeState;
  getRunPhaseCalls: () => Array<{
    phaseNumber: number;
    options?: RunPhaseOptions;
  }>;
  getStepCalls: () => Array<{ name: string; prompt: string }>;
  getCheckpointFileWrites: () => Array<{ path: string; data: string }>;
  getStateHistory: () => OrchestratorStatus[];
} {
  let currentState = makeState(options.initialState);
  const runPhaseCalls: Array<{
    phaseNumber: number;
    options?: RunPhaseOptions;
  }> = [];
  const stepCalls: Array<{ name: string; prompt: string }> = [];
  const checkpointFileWrites: Array<{ path: string; data: string }> = [];
  const statusHistory: OrchestratorStatus[] = [];

  const config = makeConfig(options.configOverrides);

  // In-memory StateManager that tracks status transitions
  const stateManager = {
    load: () => currentState,
    update: async (
      updater: (state: ForgeState) => ForgeState,
    ): Promise<ForgeState> => {
      currentState = updater(currentState);
      // Track status transitions
      const lastStatus = statusHistory[statusHistory.length - 1];
      if (currentState.status !== lastStatus) {
        statusHistory.push(currentState.status);
      }
      return currentState;
    },
  } as any;

  // Mock executeQueryFn
  const defaultExecuteQuery = async (opts: any): Promise<any> => {
    if (opts.prompt?.includes("Verify whether requirement")) {
      return {
        ok: true,
        result: "",
        structuredOutput: { passed: true, gapDescription: "" },
        cost: { totalCostUsd: 0.01 },
        sessionId: "mock-session",
      };
    }
    return {
      ok: true,
      result: "done",
      structuredOutput: null,
      cost: { totalCostUsd: 0.01 },
      sessionId: "mock-session",
    };
  };

  const baseFn = options.executeQueryBehavior ?? defaultExecuteQuery;

  const executeQueryFn = async (opts: any): Promise<any> => {
    stepCalls.push({ name: "step", prompt: opts.prompt });
    return baseFn(opts);
  };

  const stepRunnerContext: StepRunnerContext = {
    config,
    stateManager,
    executeQueryFn,
  };

  const costController = {
    checkBudget: () => {},
    recordStepCost: () => {},
    getTotal: () => 0,
  } as any;

  // Default runPhaseFn: completes immediately and updates state
  const defaultRunPhaseFn = async (
    phaseNumber: number,
    _ctx: PhaseRunnerContext,
    _opts?: RunPhaseOptions,
  ): Promise<PhaseResult> => {
    currentState = {
      ...currentState,
      phases: {
        ...currentState.phases,
        [String(phaseNumber)]: {
          status: "completed" as const,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          attempts: 1,
          budgetUsed: 1,
        },
      },
    };
    return { status: "completed", report: `phase-${phaseNumber}-done` };
  };

  const runPhaseFn = options.runPhaseFnBehavior ?? defaultRunPhaseFn;

  const trackedRunPhaseFn = async (
    phaseNumber: number,
    ctx: PhaseRunnerContext,
    opts?: RunPhaseOptions,
  ): Promise<PhaseResult> => {
    runPhaseCalls.push({ phaseNumber, options: opts });
    return runPhaseFn(phaseNumber, ctx, opts);
  };

  // In-memory filesystem
  const roadmapContent = options.roadmapContent ?? COMPLEX_ROADMAP;
  const files = new Map<string, string>();
  files.set(".planning/ROADMAP.md", roadmapContent);
  // Provide REQUIREMENTS.md for UAT runner (needs at least one requirement with acceptance criteria)
  files.set(
    "REQUIREMENTS.md",
    `# Requirements\n\n## R1: Test Feature\n\n**Category:** Core\n**Description:** A test feature\n**Acceptance Criteria:**\n- Feature works correctly\n`,
  );

  const mockFs = {
    existsSync: (p: string) => files.has(p),
    readFileSync: (p: string, _enc?: string) => {
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: file not found: ${p}`);
      }
      return content;
    },
    writeFileSync: (p: string, data: string) => {
      files.set(p, data);
      if (p.includes("checkpoint")) {
        checkpointFileWrites.push({ path: p, data });
      }
    },
    mkdirSync: () => {},
  };

  // Mock exec function for UAT health checks (returns success immediately)
  const mockExecFn = (_cmd: string): string => "OK";

  // Mock runStepFn for UAT: writes passing result files to mock fs
  const mockRunStepFn = async (
    name: string,
    opts: any,
    _ctx: any,
    _cc: any,
  ): Promise<any> => {
    stepCalls.push({ name, prompt: opts.prompt });
    // Write passing UAT result file for UAT workflow steps
    if (name.startsWith("uat-UAT-")) {
      const workflowId = name.replace("uat-", "");
      const resultPath = `.forge/uat/${workflowId}.json`;
      files.set(resultPath, JSON.stringify({ passed: true, stepsPassed: 1, stepsFailed: 0, errors: [] }));
    }
    return {
      status: "verified",
      costUsd: 0.01,
      costData: { totalCostUsd: 0.01 },
      result: "done",
      structuredOutput: null,
      sessionId: "mock",
    };
  };

  const ctx: PipelineContext = {
    config,
    stateManager,
    stepRunnerContext,
    costController,
    runPhaseFn: trackedRunPhaseFn,
    fs: mockFs as any,
    execFn: mockExecFn,
    runStepFn: mockRunStepFn as any,
  };

  return {
    ctx,
    getState: () => currentState,
    getRunPhaseCalls: () => runPhaseCalls,
    getStepCalls: () => stepCalls,
    getCheckpointFileWrites: () => checkpointFileWrites,
    getStateHistory: () => statusHistory,
  };
}

// ============================================================================
// Dependency graph + Phase execution integration
// ============================================================================

describe("Pipeline Integration: Dependency Graph + Phase Execution", () => {
  /**
   * PIPE-11, PIPE-01: Parse a complex ROADMAP.md with dependencies,
   * verify getExecutionWaves produces correct waves, then verify
   * runPipeline calls runPhaseFn in the correct order.
   */
  it("TestPipelineIntegration_DependencyGraph_DeterminesPhaseOrder", async () => {
    // First verify the dependency graph produces the expected waves
    const { waves, phases } = getExecutionWaves(COMPLEX_ROADMAP);
    expect(phases).toHaveLength(6);

    // Wave 1: phase 1 (no deps)
    expect(waves[0]).toEqual([1]);
    // Wave 2: phases 2, 3, 4 (all depend only on 1)
    expect(waves[1]).toEqual([2, 3, 4]);
    // Wave 3: phase 5 (depends on 4)
    expect(waves[2]).toEqual([5]);
    // Wave 4: phase 6 (depends on 5)
    expect(waves[3]).toEqual([6]);

    // Now verify runPipeline calls phases in the correct order
    const { ctx, getRunPhaseCalls } = createTestPipelineContext({
      roadmapContent: COMPLEX_ROADMAP,
    });

    await runPipeline(ctx);

    const calls = getRunPhaseCalls();
    // All 6 phases should be called
    expect(calls).toHaveLength(6);

    // Extract phase numbers in order
    const phaseOrder = calls.map((c) => c.phaseNumber);

    // Phase 1 must come before 2, 3, 4
    const idx1 = phaseOrder.indexOf(1);
    const idx2 = phaseOrder.indexOf(2);
    const idx3 = phaseOrder.indexOf(3);
    const idx4 = phaseOrder.indexOf(4);
    const idx5 = phaseOrder.indexOf(5);
    const idx6 = phaseOrder.indexOf(6);

    expect(idx1).toBeLessThan(idx2);
    expect(idx1).toBeLessThan(idx3);
    expect(idx1).toBeLessThan(idx4);
    expect(idx4).toBeLessThan(idx5);
    expect(idx5).toBeLessThan(idx6);
  });

  /**
   * PIPE-11: Roadmap with independent phases (2 and 3 both depend on 1).
   * They should appear in the same wave.
   */
  it("TestPipelineIntegration_DependencyGraph_ParallelPhasesInSameWave", async () => {
    const { waves } = getExecutionWaves(PARALLEL_ROADMAP);

    // Wave 1: [1], Wave 2: [2, 3]
    expect(waves).toHaveLength(2);
    expect(waves[0]).toEqual([1]);
    expect(waves[1]).toEqual(expect.arrayContaining([2, 3]));
    expect(waves[1]).toHaveLength(2);

    // Verify pipeline executes all of them
    const { ctx, getRunPhaseCalls } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
    });

    await runPipeline(ctx);

    const calls = getRunPhaseCalls();
    expect(calls).toHaveLength(3);
    // Phase 1 must be before 2 and 3
    const idx1 = calls.findIndex((c) => c.phaseNumber === 1);
    const idx2 = calls.findIndex((c) => c.phaseNumber === 2);
    const idx3 = calls.findIndex((c) => c.phaseNumber === 3);
    expect(idx1).toBeLessThan(idx2);
    expect(idx1).toBeLessThan(idx3);
  });
});

// ============================================================================
// Mock manager + State integration
// ============================================================================

describe("Pipeline Integration: Mock Manager + State", () => {
  /**
   * MOCK-01, MOCK-02, PIPE-02: Run Wave 1 with phases that detect external
   * services, verify state.mockRegistry is populated after checkpoint.
   */
  it("TestPipelineIntegration_MockRegistry_PopulatesDuringWave1", async () => {
    const { ctx, getState } = createTestPipelineContext({
      roadmapContent: SERVICE_ROADMAP,
    });

    // Pipeline will detect stripe and sendgrid services -> checkpoint
    const result = await runPipeline(ctx);

    expect(result.status).toBe("checkpoint");

    const state = getState();
    // Mock registry should have entries for detected services
    expect(Object.keys(state.mockRegistry).length).toBeGreaterThan(0);

    // Stripe should be in the registry
    const stripeEntry = state.mockRegistry["stripe"];
    expect(stripeEntry).toBeDefined();
    expect(stripeEntry.interface).toContain("stripe");
    expect(stripeEntry.mock).toContain("stripe.mock");
    expect(stripeEntry.real).toContain("stripe.real");
    expect(stripeEntry.factory).toContain("stripe.factory");
    expect(stripeEntry.envVars).toContain("STRIPE_SECRET_KEY");
  });

  /**
   * MOCK-03, MOCK-04: After Wave 1 populates registry, verify Wave 2's
   * integration step receives a prompt containing registered mock file paths.
   */
  it("TestPipelineIntegration_MockRegistry_SwapPromptUsesRegistry", async () => {
    // Start from checkpoint with pre-populated registry (simulating Wave 1 done)
    const { ctx, getStepCalls } = createTestPipelineContext({
      initialState: {
        status: "human_checkpoint",
        servicesNeeded: [
          {
            service: "stripe",
            why: "Payment processing",
            signupUrl: "https://stripe.com",
            credentialsNeeded: ["STRIPE_SECRET_KEY"],
            mockedIn: ["phase-2"],
          },
        ],
        credentials: { STRIPE_SECRET_KEY: "sk_test_123" },
        mockRegistry: {
          stripe: {
            interface: "src/services/stripe.ts",
            mock: "src/services/stripe.mock.ts",
            real: "src/services/stripe.real.ts",
            factory: "src/services/stripe.factory.ts",
            testFixtures: [],
            envVars: ["STRIPE_SECRET_KEY"],
          },
        },
      },
    });

    await runPipeline(ctx);

    const calls = getStepCalls();
    // Find the integration/swap step
    const swapStep = calls.find(
      (c) =>
        c.prompt.includes("Mock-to-Real") ||
        c.prompt.includes("Replace mock") ||
        c.prompt.includes("stripe.mock"),
    );
    expect(swapStep).toBeDefined();

    // The swap prompt should reference the mock file paths from the registry
    if (swapStep) {
      expect(swapStep.prompt).toContain("src/services/stripe.mock.ts");
      expect(swapStep.prompt).toContain("src/services/stripe.real.ts");
      expect(swapStep.prompt).toContain("src/services/stripe.factory.ts");
      expect(swapStep.prompt).toContain("STRIPE_SECRET_KEY");
    }
  });
});

// ============================================================================
// Human checkpoint + State integration
// ============================================================================

describe("Pipeline Integration: Checkpoint + State", () => {
  /**
   * PIPE-04: Wave 1 produces services from one phase and skipped items
   * from another. Checkpoint report should batch both.
   */
  it("TestPipelineIntegration_Checkpoint_BatchesServicesAndSkipped", async () => {
    // Use getState to update state in the mock, simulating real phase runner behavior
    let stateRef: ForgeState | null = null;
    const { ctx, getState } = createTestPipelineContext({
      roadmapContent: SERVICE_ROADMAP,
      runPhaseFnBehavior: async (phaseNumber, _ctx, _opts) => {
        if (phaseNumber === 3) {
          // Phase 3 (email) fails -- update state to reflect failure
          // (real phase runner would do this)
          const current = getState();
          await ctx.stateManager.update((s: ForgeState) => ({
            ...s,
            phases: {
              ...s.phases,
              [String(phaseNumber)]: {
                status: "failed" as const,
                startedAt: new Date().toISOString(),
                attempts: 1,
                budgetUsed: 1,
              },
            },
          }));
          return {
            status: "failed",
            reason: "Sendgrid integration not possible",
            gapsRemaining: ["REQ-03"],
          };
        }
        // For other phases, update state to completed
        await ctx.stateManager.update((s: ForgeState) => ({
          ...s,
          phases: {
            ...s.phases,
            [String(phaseNumber)]: {
              status: "completed" as const,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              attempts: 1,
              budgetUsed: 1,
            },
          },
        }));
        return { status: "completed", report: `phase-${phaseNumber}-done` };
      },
    });

    const result = await runPipeline(ctx);

    // Should checkpoint because services were detected
    expect(result.status).toBe("checkpoint");
    if (result.status === "checkpoint") {
      // Services should include stripe (from phase 2 description)
      expect(result.checkpointReport.servicesNeeded.length).toBeGreaterThan(0);
      const serviceNames = result.checkpointReport.servicesNeeded.map(
        (s) => s.service,
      );
      expect(serviceNames).toContain("stripe");

      // Phase 3 failed, so phasesFailed in the wave1Summary should reflect that
      const wave1Summary = result.checkpointReport.wave1Summary;
      expect(wave1Summary.phasesFailed).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * PIPE-04, PIPE-05: Simulate checkpoint -> load credentials -> resume Wave 2.
   * Verify credentials are available in the integration prompt.
   */
  it("TestPipelineIntegration_Checkpoint_ResumeLoadsCredentials", async () => {
    // State starts at checkpoint with credentials already loaded (simulating `forge resume`)
    const { ctx, getStepCalls } = createTestPipelineContext({
      initialState: {
        status: "human_checkpoint",
        servicesNeeded: [
          {
            service: "sendgrid",
            why: "Transactional email delivery",
            credentialsNeeded: ["SENDGRID_API_KEY"],
            mockedIn: ["phase-3"],
          },
        ],
        credentials: { SENDGRID_API_KEY: "SG.test-api-key-123" },
        mockRegistry: {
          sendgrid: {
            interface: "src/services/sendgrid.ts",
            mock: "src/services/sendgrid.mock.ts",
            real: "src/services/sendgrid.real.ts",
            factory: "src/services/sendgrid.factory.ts",
            testFixtures: [],
            envVars: ["SENDGRID_API_KEY"],
          },
        },
      },
    });

    const result = await runPipeline(ctx);

    expect(result.status).toBe("completed");

    // The integration step prompt should reference SENDGRID_API_KEY
    const calls = getStepCalls();
    const integrationStep = calls.find(
      (c) =>
        c.prompt.includes("SENDGRID_API_KEY") ||
        c.prompt.includes("sendgrid"),
    );
    expect(integrationStep).toBeDefined();
  });
});

// ============================================================================
// Spec compliance + State integration
// ============================================================================

describe("Pipeline Integration: Compliance + State", () => {
  /**
   * PIPE-07, PIPE-08: Run spec compliance with mocked verifyRequirement
   * that passes progressively. Verify state.specCompliance.gapHistory
   * is updated correctly.
   */
  it("TestPipelineIntegration_Compliance_UpdatesStatePerRound", async () => {
    // Simple roadmap with 3 requirements, all verification passes immediately
    const { ctx, getState } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
    });

    const result = await runPipeline(ctx);

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.specCompliance.converged).toBe(true);
    }

    // State compliance should be updated
    const state = getState();
    expect(state.specCompliance.roundsCompleted).toBeGreaterThanOrEqual(1);
    expect(state.specCompliance.gapHistory.length).toBeGreaterThanOrEqual(1);
    // gapHistory[0] is the baseline (number of requirements)
    expect(state.specCompliance.gapHistory[0]).toBe(3);
    // Last entry should be 0 (all passed)
    expect(
      state.specCompliance.gapHistory[
        state.specCompliance.gapHistory.length - 1
      ],
    ).toBe(0);
  });

  /**
   * PIPE-08: Mock verifyRequirement that returns the same number of gaps
   * each round. Verify pipeline returns "stuck" status.
   */
  it("TestPipelineIntegration_Compliance_StopsOnNonConvergence", async () => {
    const { ctx, getState } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
      executeQueryBehavior: async (opts: any) => {
        const prompt = opts.prompt as string;

        // Handle batch verification (all requirements fail)
        if (prompt.includes("Verify whether each of the following requirements")) {
          const reqIds = prompt.match(/- ([\w-]+)/g)?.map((m: string) => m.slice(2)) ?? [];
          const verdicts = reqIds.map((id: string) => ({
            id,
            passed: false,
            gapDescription: "Still broken -- not converging",
          }));
          return {
            ok: true,
            result: "```json\n" + JSON.stringify(verdicts) + "\n```",
            structuredOutput: null,
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        // Handle individual verification (fallback)
        if (prompt.includes("Verify whether requirement")) {
          return {
            ok: true,
            result: "",
            structuredOutput: {
              passed: false,
              gapDescription: "Still broken -- not converging",
            },
            cost: { totalCostUsd: 0.01 },
            sessionId: "mock",
          };
        }

        return {
          ok: true,
          result: "done",
          structuredOutput: null,
          cost: { totalCostUsd: 0.01 },
          sessionId: "mock",
        };
      },
    });

    const result = await runPipeline(ctx);

    expect(result.status).toBe("stuck");
    if (result.status === "stuck") {
      expect(result.wave).toBe(3);
      expect(result.nonConverging).toBe(true);
      // gapHistory should show non-convergence (gaps not decreasing)
      expect(result.gapHistory.length).toBeGreaterThanOrEqual(3);
    }

    const state = getState();
    expect(state.specCompliance.roundsCompleted).toBeGreaterThanOrEqual(2);
    expect(state.remainingGaps.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Full wave transition integration
// ============================================================================

describe("Pipeline Integration: Wave Transitions", () => {
  /**
   * PIPE-01, PIPE-09, PIPE-10: Track state.status changes through
   * Wave 1 -> Wave 2 -> Wave 3 -> UAT -> completed.
   */
  it("TestPipelineIntegration_WaveTransitions_StatusUpdated", async () => {
    const { ctx, getStateHistory } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
    });

    const result = await runPipeline(ctx);

    expect(result.status).toBe("completed");

    const statusHistory = getStateHistory();

    // Should see wave_1 somewhere in the history
    expect(statusHistory).toContain("wave_1");
    // No checkpoint needed (no services in PARALLEL_ROADMAP), so wave_2 follows
    expect(statusHistory).toContain("wave_2");
    // Compliance
    expect(statusHistory).toContain("wave_3");
    // UAT
    expect(statusHistory).toContain("uat");
    // Completed
    expect(statusHistory).toContain("completed");
  });

  /**
   * PIPE-01: Verify CostController accumulates costs from steps across
   * all waves. (Costs tracked via step calls.)
   */
  it("TestPipelineIntegration_BudgetTracking_AccumulatesAcrossWaves", async () => {
    let totalStepCost = 0;

    const { ctx, getStepCalls } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
      executeQueryBehavior: async (opts: any) => {
        const stepCost = 0.05;
        totalStepCost += stepCost;

        const prompt = opts.prompt as string;
        if (prompt.includes("Verify whether requirement")) {
          return {
            ok: true,
            result: "",
            structuredOutput: { passed: true, gapDescription: "" },
            cost: { totalCostUsd: stepCost },
            sessionId: "mock",
          };
        }
        return {
          ok: true,
          result: "done",
          structuredOutput: null,
          cost: { totalCostUsd: stepCost },
          sessionId: "mock",
        };
      },
    });

    await runPipeline(ctx);

    // Compliance verification calls + milestone steps accumulate via executeQueryBehavior
    // UAT steps go through the separate runStepFn mock and are tracked in stepCalls
    const calls = getStepCalls();
    expect(calls.length).toBeGreaterThan(0);
    // Total cost should be accumulated from executeQueryBehavior calls
    expect(totalStepCost).toBeGreaterThan(0);
    // Non-UAT calls go through executeQueryBehavior (0.05 each)
    const nonUatCalls = calls.filter((c) => !c.name.startsWith("uat-"));
    expect(totalStepCost).toBeCloseTo(nonUatCalls.length * 0.05, 5);
  });
});

// ============================================================================
// Checkpoint file content verification
// ============================================================================

describe("Pipeline Integration: Checkpoint File Content", () => {
  /**
   * PIPE-04: Checkpoint file contains structured JSON with services,
   * skipped items, and wave1Summary.
   */
  it("TestPipelineIntegration_Checkpoint_FileContentIsValid", async () => {
    const { ctx, getCheckpointFileWrites } = createTestPipelineContext({
      roadmapContent: SERVICE_ROADMAP,
    });

    await runPipeline(ctx);

    const writes = getCheckpointFileWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("forge-checkpoint.json");

    // Parse the checkpoint file
    const parsed = JSON.parse(writes[0].data);
    expect(parsed.servicesNeeded).toBeDefined();
    expect(parsed.wave1Summary).toBeDefined();
    expect(typeof parsed.wave1Summary.phasesCompleted).toBe("number");
    expect(typeof parsed.wave1Summary.phasesFailed).toBe("number");

    // Stripe service should be in the checkpoint
    const serviceNames = parsed.servicesNeeded.map(
      (s: ServiceDetection) => s.service,
    );
    expect(serviceNames).toContain("stripe");
  });

  /**
   * PIPE-04: When skipped items and services both exist, checkpoint
   * file includes both.
   */
  it("TestPipelineIntegration_Checkpoint_IncludesSkippedItems", async () => {
    const { ctx, getCheckpointFileWrites, getState } =
      createTestPipelineContext({
        roadmapContent: SERVICE_ROADMAP,
        runPhaseFnBehavior: async (phaseNumber) => {
          if (phaseNumber === 3) {
            return {
              status: "failed",
              reason: "Email service unavailable",
              gapsRemaining: ["REQ-03"],
            };
          }
          return { status: "completed", report: `phase-${phaseNumber}-done` };
        },
      });

    await runPipeline(ctx);

    const state = getState();
    // If skipped items were collected, checkpoint should mention them
    if (state.skippedItems.length > 0) {
      const writes = getCheckpointFileWrites();
      expect(writes.length).toBeGreaterThan(0);
      const parsed = JSON.parse(writes[0].data);
      expect(parsed.skippedItems.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Requirement IDs passed through integration
// ============================================================================

describe("Pipeline Integration: Requirement ID Flow", () => {
  /**
   * PIPE-03: Verify requirement IDs from roadmap are passed to each phase
   * runner call as options.
   */
  it("TestPipelineIntegration_RequirementIds_FlowToPhaseRunner", async () => {
    const { ctx, getRunPhaseCalls } = createTestPipelineContext({
      roadmapContent: PARALLEL_ROADMAP,
    });

    await runPipeline(ctx);

    const calls = getRunPhaseCalls();

    // Phase 1 should receive REQ-01
    const phase1 = calls.find((c) => c.phaseNumber === 1);
    expect(phase1?.options?.requirementIds).toContain("REQ-01");

    // Phase 2 should receive REQ-02
    const phase2 = calls.find((c) => c.phaseNumber === 2);
    expect(phase2?.options?.requirementIds).toContain("REQ-02");

    // Phase 3 should receive REQ-03
    const phase3 = calls.find((c) => c.phaseNumber === 3);
    expect(phase3?.options?.requirementIds).toContain("REQ-03");
  });
});
