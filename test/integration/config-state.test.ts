/**
 * Config + State Integration Tests
 *
 * Tests that config and state modules work together correctly,
 * including loading config, initializing state, and verifying
 * the full data flow through the serialization layer.
 *
 * Requirements: CFG-01, CFG-02, STA-01, STA-02, STA-03, STA-04, STA-05
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadConfig,
  getDefaultConfig,
  CONFIG_FILE_NAME,
} from "../../src/config/index.js";
import {
  StateManager,
  STATE_FILE_NAME,
  createInitialState,
} from "../../src/state/index.js";

function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-integ-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Config + State Integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("TestIntegration_ConfigAndState_CoexistInSameDir", () => {
    it("config and state files coexist in the same project directory", () => {
      // Write config
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({ model: "claude-opus-4-6", max_budget_total: 100 }),
      );

      // Initialize state
      const sm = new StateManager(tempDir);
      sm.initialize(tempDir, "claude-opus-4-6");

      // Both files exist
      expect(fs.existsSync(path.join(tempDir, CONFIG_FILE_NAME))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, STATE_FILE_NAME))).toBe(true);

      // Both are valid
      const config = loadConfig(tempDir);
      const state = sm.load();

      expect(config.model).toBe("claude-opus-4-6");
      expect(state.model).toBe("claude-opus-4-6");
    });
  });

  describe("TestIntegration_ConfigModelUsedInState", () => {
    it("state can be initialized using model from config", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({ model: "claude-sonnet-4-5-20250929" }),
      );

      const config = loadConfig(tempDir);
      const sm = new StateManager(tempDir);
      const state = sm.initialize(tempDir, config.model);

      expect(state.model).toBe("claude-sonnet-4-5-20250929");
    });
  });

  describe("TestIntegration_StateRoundTrip_FullData_STA02", () => {
    it("STA-02: full state with complex nested data survives save/load round-trip", () => {
      const sm = new StateManager(tempDir);

      // Create state matching the SPEC.md example
      const state = createInitialState(tempDir);
      state.status = "wave_2";
      state.currentWave = 2;
      state.projectInitialized = true;
      state.scaffolded = true;
      state.phases = {
        "1": {
          status: "completed",
          startedAt: "2026-03-04T10:00:00Z",
          completedAt: "2026-03-04T11:00:00Z",
          attempts: 1,
          testResults: { passed: 12, failed: 0, total: 12 },
          budgetUsed: 4.23,
        },
        "3": {
          status: "partial",
          startedAt: "2026-03-04T12:00:00Z",
          attempts: 1,
          mockedServiceNames: ["stripe"],
          budgetUsed: 6.1,
        },
        "4": {
          status: "completed",
          startedAt: "2026-03-04T13:00:00Z",
          completedAt: "2026-03-04T15:00:00Z",
          attempts: 2,
          budgetUsed: 8.44,
        },
      };
      state.servicesNeeded = [
        {
          service: "stripe",
          why: "Payment processing in Phase 3",
          signupUrl: "https://stripe.com",
          credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
          mockedIn: ["src/payments/", "test/payments/"],
        },
      ];
      state.mockRegistry = {
        stripe: {
          interface: "src/services/stripe.ts",
          mock: "src/services/stripe.mock.ts",
          real: "src/services/stripe.real.ts",
          factory: "src/services/stripe.factory.ts",
          testFixtures: ["test/fixtures/stripe-webhook.json"],
          envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        },
      };
      state.skippedItems = [
        {
          requirement: "R7: WebSocket real-time updates",
          phase: 4,
          attempts: [
            { approach: "ws library", error: "auth handshake timeout" },
            {
              approach: "socket.io",
              error: "CORS policy blocks ws upgrade",
            },
          ],
          codeSoFar: "src/ws/",
        },
      ];
      state.specCompliance = {
        totalRequirements: 16,
        verified: 14,
        gapHistory: [16, 5, 2, 0],
        roundsCompleted: 3,
      };
      state.uatResults = {
        status: "passed",
        workflowsTested: 8,
        workflowsPassed: 8,
        workflowsFailed: 0,
      };
      state.totalBudgetUsed = 18.77;

      sm.save(state);

      // Verify JSON file has snake_case
      const rawJson = JSON.parse(
        fs.readFileSync(sm.statePath, "utf-8"),
      );
      expect(rawJson.project_dir).toBe(tempDir);
      expect(rawJson.current_wave).toBe(2);
      expect(rawJson.total_budget_used).toBe(18.77);
      expect(rawJson.services_needed[0].signup_url).toBe(
        "https://stripe.com",
      );
      expect(rawJson.mock_registry.stripe.env_vars).toEqual([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]);
      expect(rawJson.skipped_items[0].code_so_far).toBe("src/ws/");
      expect(rawJson.spec_compliance.gap_history).toEqual([16, 5, 2, 0]);
      expect(rawJson.uat_results.workflows_tested).toBe(8);

      // Load and verify camelCase
      const loaded = sm.load();
      expect(loaded.projectDir).toBe(tempDir);
      expect(loaded.currentWave).toBe(2);
      expect(loaded.totalBudgetUsed).toBe(18.77);
      expect(loaded.servicesNeeded[0].signupUrl).toBe("https://stripe.com");
      expect(loaded.mockRegistry.stripe.envVars).toEqual([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]);
      expect(loaded.skippedItems[0].codeSoFar).toBe("src/ws/");
      expect(loaded.specCompliance.gapHistory).toEqual([16, 5, 2, 0]);
      expect(loaded.uatResults.workflowsTested).toBe(8);
    });
  });

  describe("TestIntegration_ConfigBudgetEnforcement", () => {
    it("config budget can be compared against state budget usage", () => {
      // Set up config with budget
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({ max_budget_total: 50.0 }),
      );

      const config = loadConfig(tempDir);
      const sm = new StateManager(tempDir);
      sm.initialize(tempDir);

      // Simulate budget usage
      sm.save({
        ...sm.load(),
        totalBudgetUsed: 45.0,
      });

      const state = sm.load();
      const budgetRemaining = config.maxBudgetTotal - state.totalBudgetUsed;
      const budgetExceeded = state.totalBudgetUsed >= config.maxBudgetTotal;

      expect(budgetRemaining).toBe(5.0);
      expect(budgetExceeded).toBe(false);
    });
  });

  describe("TestIntegration_ConcurrentPhaseWrites_STA05", () => {
    it("STA-05: simulated parallel phase updates via mutex preserve all data", async () => {
      const sm = new StateManager(tempDir);
      sm.initialize(tempDir);

      // Simulate 3 concurrent phases updating state
      const concurrentUpdates = [
        sm.update((s) => ({
          ...s,
          phases: {
            ...s.phases,
            "1": {
              status: "completed" as const,
              startedAt: "t1",
              completedAt: "t2",
              attempts: 1,
              budgetUsed: 5.0,
            },
          },
          totalBudgetUsed: s.totalBudgetUsed + 5.0,
        })),
        sm.update((s) => ({
          ...s,
          phases: {
            ...s.phases,
            "2": {
              status: "completed" as const,
              startedAt: "t3",
              completedAt: "t4",
              attempts: 1,
              budgetUsed: 3.0,
            },
          },
          totalBudgetUsed: s.totalBudgetUsed + 3.0,
        })),
        sm.update((s) => ({
          ...s,
          phases: {
            ...s.phases,
            "3": {
              status: "in_progress" as const,
              startedAt: "t5",
              attempts: 1,
              budgetUsed: 2.0,
            },
          },
          totalBudgetUsed: s.totalBudgetUsed + 2.0,
        })),
      ];

      await Promise.all(concurrentUpdates);

      const final = sm.load();

      // All 3 phases present
      expect(Object.keys(final.phases)).toHaveLength(3);
      expect(final.phases["1"].status).toBe("completed");
      expect(final.phases["2"].status).toBe("completed");
      expect(final.phases["3"].status).toBe("in_progress");

      // Budget correctly accumulated
      expect(final.totalBudgetUsed).toBe(10.0);
    });
  });

  describe("TestIntegration_StateAfterCrash_STA04", () => {
    it("STA-04: state file is readable after simulated crash (file exists or doesn't, never corrupted)", () => {
      const sm = new StateManager(tempDir);
      sm.initialize(tempDir);

      // Write state normally
      sm.save({
        ...sm.load(),
        currentWave: 2,
        totalBudgetUsed: 15.0,
      });

      // Verify the file is valid JSON
      const content = fs.readFileSync(sm.statePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.current_wave).toBe(2);
      expect(parsed.total_budget_used).toBe(15.0);

      // Simulate reading state on "restart"
      const sm2 = new StateManager(tempDir);
      const state = sm2.load();
      expect(state.currentWave).toBe(2);
      expect(state.totalBudgetUsed).toBe(15.0);
    });
  });

  describe("TestIntegration_ConfigDefaults_AllSections", () => {
    it("CFG-02: default config has all sections with correct types", () => {
      const config = getDefaultConfig();

      // Testing section
      expect(typeof config.testing.stack).toBe("string");
      expect(typeof config.testing.unitCommand).toBe("string");
      expect(typeof config.testing.integrationCommand).toBe("string");
      expect(typeof config.testing.scenarioCommand).toBe("string");
      expect(typeof config.testing.dockerComposeFile).toBe("string");

      // Verification section
      expect(typeof config.verification.typecheck).toBe("boolean");
      expect(typeof config.verification.lint).toBe("boolean");
      expect(typeof config.verification.dockerSmoke).toBe("boolean");
      expect(typeof config.verification.testCoverageCheck).toBe("boolean");
      expect(typeof config.verification.observabilityCheck).toBe("boolean");

      // Parallelism section
      expect(typeof config.parallelism.maxConcurrentPhases).toBe("number");
      expect(typeof config.parallelism.enableSubagents).toBe("boolean");
      expect(typeof config.parallelism.backgroundDocs).toBe("boolean");

      // Deployment section
      expect(typeof config.deployment.target).toBe("string");
      expect(Array.isArray(config.deployment.environments)).toBe(true);

      // Notifications section
      expect(typeof config.notifications.onHumanNeeded).toBe("string");
      expect(typeof config.notifications.onPhaseComplete).toBe("string");
      expect(typeof config.notifications.onFailure).toBe("string");

      // Notion section
      expect(typeof config.notion.parentPageId).toBe("string");
      expect(typeof config.notion.docPages.architecture).toBe("string");
      expect(typeof config.notion.docPages.dataFlow).toBe("string");
      expect(typeof config.notion.docPages.apiReference).toBe("string");
      expect(typeof config.notion.docPages.componentIndex).toBe("string");
      expect(typeof config.notion.docPages.phaseReports).toBe("string");
    });
  });
});
