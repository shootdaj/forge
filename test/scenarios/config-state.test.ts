/**
 * Config + State Scenario Tests
 *
 * End-to-end scenarios simulating real Forge workflows:
 * - Fresh project initialization
 * - Crash recovery with state resumption
 * - Config + state lifecycle across waves
 *
 * Requirements: CFG-01, CFG-02, CFG-03, STA-01, STA-02, STA-03, STA-04, STA-05
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadConfig,
  CONFIG_FILE_NAME,
  type ForgeConfig,
} from "../../src/config/index.js";
import {
  StateManager,
  STATE_FILE_NAME,
  createInitialState,
  type ForgeState,
} from "../../src/state/index.js";

function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-scenario-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Scenario: Fresh Project Initialization", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_ForgeInit_CreatesConfigAndState", () => {
    // Scenario: User runs `forge init` on a new project
    // 1. Config is created with defaults (or user-provided values)
    // 2. State is initialized
    // 3. Both files are valid and loadable

    // Step 1: Write config (simulating forge init)
    fs.writeFileSync(
      path.join(tempDir, CONFIG_FILE_NAME),
      JSON.stringify(
        {
          model: "claude-opus-4-6",
          max_budget_total: 200.0,
          testing: { stack: "node" },
        },
        null,
        2,
      ),
    );

    // Step 2: Load config
    const config = loadConfig(tempDir);
    expect(config.model).toBe("claude-opus-4-6");

    // Step 3: Initialize state using config
    const sm = new StateManager(tempDir);
    const state = sm.initialize(tempDir, config.model);

    expect(state.model).toBe("claude-opus-4-6");
    expect(state.status).toBe("initializing");
    expect(state.currentWave).toBe(1);
    expect(state.totalBudgetUsed).toBe(0);
    expect(state.projectInitialized).toBe(false);

    // Step 4: Verify both files exist and are valid
    expect(fs.existsSync(path.join(tempDir, CONFIG_FILE_NAME))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, STATE_FILE_NAME))).toBe(true);

    const reloadedConfig = loadConfig(tempDir);
    const reloadedState = sm.load();
    expect(reloadedConfig.model).toBe(config.model);
    expect(reloadedState.projectDir).toBe(state.projectDir);
  });
});

describe("Scenario: Wave 1 Lifecycle", () => {
  let tempDir: string;
  let config: ForgeConfig;
  let sm: StateManager;

  beforeEach(() => {
    tempDir = createTempDir();

    // Set up project
    fs.writeFileSync(
      path.join(tempDir, CONFIG_FILE_NAME),
      JSON.stringify({ max_budget_total: 100.0, max_retries: 3 }),
    );
    config = loadConfig(tempDir);
    sm = new StateManager(tempDir);
    sm.initialize(tempDir, config.model);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_Wave1_PhaseProgression", async () => {
    // Scenario: Forge executes Wave 1 phases

    // Phase 1 starts
    await sm.update((s) => ({
      ...s,
      status: "wave_1" as const,
      phases: {
        "1": {
          status: "in_progress" as const,
          startedAt: new Date().toISOString(),
          attempts: 1,
          budgetUsed: 0,
        },
      },
    }));

    let state = sm.load();
    expect(state.status).toBe("wave_1");
    expect(state.phases["1"].status).toBe("in_progress");

    // Phase 1 completes
    await sm.update((s) => ({
      ...s,
      phases: {
        ...s.phases,
        "1": {
          ...s.phases["1"],
          status: "completed" as const,
          completedAt: new Date().toISOString(),
          testResults: { passed: 12, failed: 0, total: 12 },
          budgetUsed: 4.23,
        },
      },
      totalBudgetUsed: s.totalBudgetUsed + 4.23,
    }));

    state = sm.load();
    expect(state.phases["1"].status).toBe("completed");
    expect(state.phases["1"].testResults?.passed).toBe(12);
    expect(state.totalBudgetUsed).toBe(4.23);

    // Phase 2 starts with a service that needs mocking
    await sm.update((s) => ({
      ...s,
      phases: {
        ...s.phases,
        "2": {
          status: "partial" as const,
          startedAt: new Date().toISOString(),
          attempts: 1,
          mockedServiceNames: ["stripe"],
          budgetUsed: 6.1,
        },
      },
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payment processing",
          signupUrl: "https://stripe.com",
          credentialsNeeded: ["STRIPE_KEY"],
          mockedIn: ["src/payments/"],
        },
      ],
      mockRegistry: {
        stripe: {
          interface: "src/services/stripe.ts",
          mock: "src/services/stripe.mock.ts",
          real: "src/services/stripe.real.ts",
          factory: "src/services/stripe.factory.ts",
          testFixtures: [],
          envVars: ["STRIPE_KEY"],
        },
      },
      totalBudgetUsed: s.totalBudgetUsed + 6.1,
    }));

    state = sm.load();
    expect(state.phases["2"].status).toBe("partial");
    expect(state.phases["2"].mockedServiceNames).toContain("stripe");
    expect(state.servicesNeeded).toHaveLength(1);
    expect(state.mockRegistry.stripe.interface).toBe(
      "src/services/stripe.ts",
    );
    expect(state.totalBudgetUsed).toBeCloseTo(10.33);

    // Budget check before next step
    const budgetRemaining =
      config.maxBudgetTotal - state.totalBudgetUsed;
    expect(budgetRemaining).toBeGreaterThan(0);
    expect(budgetRemaining).toBeCloseTo(89.67);
  });
});

describe("Scenario: Crash Recovery", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_CrashRecovery_StatePreserved_STA04", () => {
    // Scenario: Process crashes mid-wave, forge restarts

    // Step 1: Normal state evolution
    const sm = new StateManager(tempDir);
    sm.initialize(tempDir);

    const stateBeforeCrash: ForgeState = {
      ...sm.load(),
      status: "wave_1",
      currentWave: 1,
      projectInitialized: true,
      phases: {
        "1": {
          status: "completed",
          startedAt: "2026-03-04T10:00:00Z",
          completedAt: "2026-03-04T11:00:00Z",
          attempts: 1,
          testResults: { passed: 20, failed: 0, total: 20 },
          budgetUsed: 5.5,
        },
        "2": {
          status: "in_progress",
          startedAt: "2026-03-04T11:30:00Z",
          attempts: 1,
          budgetUsed: 2.3,
        },
      },
      totalBudgetUsed: 7.8,
    };

    sm.save(stateBeforeCrash);

    // Step 2: Simulate crash (process killed, state file intact due to atomic writes)
    // No code here -- the crash is simulated by not having a clean shutdown

    // Step 3: "Restart" -- new StateManager instance
    const sm2 = new StateManager(tempDir);
    expect(sm2.exists()).toBe(true);

    const recoveredState = sm2.load();

    // All state preserved
    expect(recoveredState.status).toBe("wave_1");
    expect(recoveredState.currentWave).toBe(1);
    expect(recoveredState.projectInitialized).toBe(true);
    expect(recoveredState.phases["1"].status).toBe("completed");
    expect(recoveredState.phases["1"].testResults?.passed).toBe(20);
    expect(recoveredState.phases["2"].status).toBe("in_progress");
    expect(recoveredState.totalBudgetUsed).toBe(7.8);

    // Can continue from where we left off
    sm2.save({
      ...recoveredState,
      phases: {
        ...recoveredState.phases,
        "2": {
          ...recoveredState.phases["2"],
          status: "completed",
          completedAt: "2026-03-04T12:00:00Z",
          testResults: { passed: 15, failed: 0, total: 15 },
          budgetUsed: 4.0,
        },
      },
      totalBudgetUsed: recoveredState.totalBudgetUsed + 1.7,
    });

    const finalState = sm2.load();
    expect(finalState.phases["2"].status).toBe("completed");
    expect(finalState.totalBudgetUsed).toBe(9.5);
  });

  it("TestScenario_CrashRecovery_ConfigStillLoadable_STA04", () => {
    // Config file is never modified during execution, so it always survives crashes
    fs.writeFileSync(
      path.join(tempDir, CONFIG_FILE_NAME),
      JSON.stringify({ max_budget_total: 150.0, max_retries: 5 }),
    );

    // "Restart"
    const config = loadConfig(tempDir);
    expect(config.maxBudgetTotal).toBe(150.0);
    expect(config.maxRetries).toBe(5);
  });
});

describe("Scenario: Human Checkpoint and Wave Transition", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_WaveTransition_State_STA03", async () => {
    // Scenario: Forge transitions from Wave 1 -> Human Checkpoint -> Wave 2

    const sm = new StateManager(tempDir);
    sm.initialize(tempDir);

    // Wave 1 complete
    await sm.update((s) => ({
      ...s,
      status: "human_checkpoint" as const,
      currentWave: 1,
      phases: {
        "1": {
          status: "completed" as const,
          attempts: 1,
          budgetUsed: 5,
        },
        "2": {
          status: "partial" as const,
          attempts: 1,
          mockedServiceNames: ["stripe"],
          budgetUsed: 6,
        },
      },
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payments",
          credentialsNeeded: ["KEY"],
          mockedIn: ["src/payments/"],
        },
      ],
      skippedItems: [
        {
          requirement: "R7: WebSocket",
          phase: 3,
          attempts: [{ approach: "ws", error: "auth timeout" }],
        },
      ],
      totalBudgetUsed: 11,
    }));

    let state = sm.load();
    expect(state.status).toBe("human_checkpoint");

    // User provides credentials and guidance (forge resume)
    await sm.update((s) => ({
      ...s,
      status: "wave_2" as const,
      currentWave: 2,
      credentials: { STRIPE_KEY: "sk_test_abc" },
      humanGuidance: { "R7: WebSocket": "Use socket.io v4 with CORS config" },
    }));

    state = sm.load();
    expect(state.status).toBe("wave_2");
    expect(state.currentWave).toBe(2);
    expect(state.credentials.STRIPE_KEY).toBe("sk_test_abc");
    expect(state.humanGuidance["R7: WebSocket"]).toBe(
      "Use socket.io v4 with CORS config",
    );
  });
});

describe("Scenario: Spec Compliance Tracking", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_SpecCompliance_ConvergenceTracking_STA03", async () => {
    // Scenario: Wave 3+ spec compliance loop with convergence tracking

    const sm = new StateManager(tempDir);
    sm.initialize(tempDir);

    // Round 1: 16 gaps
    await sm.update((s) => ({
      ...s,
      status: "wave_3" as const,
      currentWave: 3,
      specCompliance: {
        totalRequirements: 16,
        verified: 0,
        gapHistory: [16],
        roundsCompleted: 1,
      },
    }));

    // Round 2: 5 gaps (converging)
    await sm.update((s) => ({
      ...s,
      specCompliance: {
        ...s.specCompliance,
        verified: 11,
        gapHistory: [...s.specCompliance.gapHistory, 5],
        roundsCompleted: 2,
      },
    }));

    // Round 3: 2 gaps (still converging)
    await sm.update((s) => ({
      ...s,
      specCompliance: {
        ...s.specCompliance,
        verified: 14,
        gapHistory: [...s.specCompliance.gapHistory, 2],
        roundsCompleted: 3,
      },
    }));

    // Round 4: 0 gaps (done!)
    await sm.update((s) => ({
      ...s,
      specCompliance: {
        ...s.specCompliance,
        verified: 16,
        gapHistory: [...s.specCompliance.gapHistory, 0],
        roundsCompleted: 4,
      },
    }));

    const state = sm.load();
    expect(state.specCompliance.totalRequirements).toBe(16);
    expect(state.specCompliance.verified).toBe(16);
    expect(state.specCompliance.gapHistory).toEqual([16, 5, 2, 0]);
    expect(state.specCompliance.roundsCompleted).toBe(4);

    // Check convergence: each round has fewer gaps
    const gaps = state.specCompliance.gapHistory;
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeLessThan(gaps[i - 1]);
    }
  });
});

describe("Scenario: Budget Enforcement", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("TestScenario_BudgetCheck_StopsWhenExceeded", async () => {
    fs.writeFileSync(
      path.join(tempDir, CONFIG_FILE_NAME),
      JSON.stringify({ max_budget_total: 20.0, max_budget_per_step: 5.0 }),
    );

    const config = loadConfig(tempDir);
    const sm = new StateManager(tempDir);
    sm.initialize(tempDir);

    // Simulate several steps consuming budget
    for (let i = 1; i <= 4; i++) {
      await sm.update((s) => ({
        ...s,
        totalBudgetUsed: s.totalBudgetUsed + 5.0,
      }));
    }

    const state = sm.load();
    expect(state.totalBudgetUsed).toBe(20.0);

    // Budget check: should stop
    const budgetExceeded =
      state.totalBudgetUsed >= config.maxBudgetTotal;
    expect(budgetExceeded).toBe(true);

    // Next step should be refused
    const canStartStep =
      state.totalBudgetUsed + config.maxBudgetPerStep <=
      config.maxBudgetTotal;
    expect(canStartStep).toBe(false);
  });
});
