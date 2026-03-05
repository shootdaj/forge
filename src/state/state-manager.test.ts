/**
 * State Manager Unit Tests
 *
 * Tests for forge-state.json persistence, crash safety, and concurrency.
 *
 * Requirements: STA-01, STA-02, STA-03, STA-04, STA-05
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  StateManager,
  StateLoadError,
  StateValidationError,
  STATE_FILE_NAME,
  createInitialState,
  atomicWriteSync,
} from "./index.js";
import type { ForgeState } from "./schema.js";

/**
 * Helper to create a temp directory for test isolation.
 */
function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("State Manager", () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tempDir = createTempDir();
    stateManager = new StateManager(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("TestCreateInitialState_AllFieldsPresent_STA03", () => {
    it("STA-03: creates state with all required fields", () => {
      const state = createInitialState("/path/to/project");

      // All SPEC.md fields
      expect(state.projectDir).toBe("/path/to/project");
      expect(state.startedAt).toBeDefined();
      expect(state.model).toBe("claude-opus-4-6");
      expect(state.requirementsDoc).toBe("REQUIREMENTS.md");
      expect(state.status).toBe("initializing");
      expect(state.currentWave).toBe(1);
      expect(state.projectInitialized).toBe(false);
      expect(state.scaffolded).toBe(false);
      expect(state.phases).toEqual({});
      expect(state.servicesNeeded).toEqual([]);
      expect(state.mockRegistry).toEqual({});
      expect(state.skippedItems).toEqual([]);
      expect(state.credentials).toEqual({});
      expect(state.humanGuidance).toEqual({});
      expect(state.specCompliance).toEqual({
        totalRequirements: 0,
        verified: 0,
        gapHistory: [],
        roundsCompleted: 0,
      });
      expect(state.remainingGaps).toEqual([]);
      expect(state.uatResults).toEqual({
        status: "not_started",
        workflowsTested: 0,
        workflowsPassed: 0,
        workflowsFailed: 0,
      });
      expect(state.totalBudgetUsed).toBe(0);
    });
  });

  describe("TestCreateInitialState_CustomModel", () => {
    it("accepts a custom model override", () => {
      const state = createInitialState("/path", "claude-sonnet-4-5-20250929");
      expect(state.model).toBe("claude-sonnet-4-5-20250929");
    });
  });

  describe("TestStateManager_Exists_ReturnsFalseBeforeInit", () => {
    it("reports false when no state file exists", () => {
      expect(stateManager.exists()).toBe(false);
    });
  });

  describe("TestStateManager_Initialize_CreatesFile_STA01", () => {
    it("STA-01: creates forge-state.json on initialize", () => {
      stateManager.initialize(tempDir);

      expect(stateManager.exists()).toBe(true);
      expect(fs.existsSync(path.join(tempDir, STATE_FILE_NAME))).toBe(true);
    });
  });

  describe("TestStateManager_Initialize_SnakeCaseJSON_STA01", () => {
    it("STA-01: written JSON uses snake_case keys", () => {
      stateManager.initialize(tempDir);

      const raw = JSON.parse(
        fs.readFileSync(path.join(tempDir, STATE_FILE_NAME), "utf-8"),
      );

      // Check snake_case keys at top level
      expect("project_dir" in raw).toBe(true);
      expect("started_at" in raw).toBe(true);
      expect("requirements_doc" in raw).toBe(true);
      expect("current_wave" in raw).toBe(true);
      expect("project_initialized" in raw).toBe(true);
      expect("services_needed" in raw).toBe(true);
      expect("mock_registry" in raw).toBe(true);
      expect("skipped_items" in raw).toBe(true);
      expect("human_guidance" in raw).toBe(true);
      expect("spec_compliance" in raw).toBe(true);
      expect("remaining_gaps" in raw).toBe(true);
      expect("uat_results" in raw).toBe(true);
      expect("total_budget_used" in raw).toBe(true);

      // Check no camelCase keys
      expect("projectDir" in raw).toBe(false);
      expect("startedAt" in raw).toBe(false);
      expect("totalBudgetUsed" in raw).toBe(false);
    });
  });

  describe("TestStateManager_Load_CamelCaseProperties_STA02", () => {
    it("STA-02: loaded state uses camelCase properties", () => {
      stateManager.initialize(tempDir);
      const state = stateManager.load();

      // Check camelCase properties
      expect(state.projectDir).toBeDefined();
      expect(state.startedAt).toBeDefined();
      expect(state.requirementsDoc).toBeDefined();
      expect(state.currentWave).toBeDefined();
      expect(state.projectInitialized).toBeDefined();
      expect(state.servicesNeeded).toBeDefined();
      expect(state.mockRegistry).toBeDefined();
      expect(state.skippedItems).toBeDefined();
      expect(state.humanGuidance).toBeDefined();
      expect(state.specCompliance).toBeDefined();
      expect(state.remainingGaps).toBeDefined();
      expect(state.uatResults).toBeDefined();
      expect(state.totalBudgetUsed).toBeDefined();
    });
  });

  describe("TestStateManager_Load_MissingFile_ThrowsStateLoadError", () => {
    it("throws StateLoadError when state file doesn't exist", () => {
      expect(() => stateManager.load()).toThrow(StateLoadError);
      expect(() => stateManager.load()).toThrow("State file not found");
    });
  });

  describe("TestStateManager_Load_InvalidJSON_ThrowsStateLoadError", () => {
    it("throws StateLoadError for corrupted JSON", () => {
      fs.writeFileSync(
        path.join(tempDir, STATE_FILE_NAME),
        "{not valid json}}}",
      );

      expect(() => stateManager.load()).toThrow(StateLoadError);
      expect(() => stateManager.load()).toThrow("Invalid JSON");
    });
  });

  describe("TestStateManager_Load_InvalidSchema_ThrowsStateValidationError", () => {
    it("throws StateValidationError when schema validation fails", () => {
      // Missing required field (project_dir)
      fs.writeFileSync(
        path.join(tempDir, STATE_FILE_NAME),
        JSON.stringify({ status: "wave_1" }),
      );

      expect(() => stateManager.load()).toThrow(StateValidationError);
    });
  });

  describe("TestStateManager_SaveLoad_RoundTrip_STA02", () => {
    it("STA-02: save then load preserves all data through case transform", () => {
      const original = createInitialState(tempDir);
      original.totalBudgetUsed = 42.5;
      original.currentWave = 2;
      original.status = "wave_2";
      original.phases = {
        "1": {
          status: "completed",
          startedAt: "2026-03-04T00:00:00Z",
          completedAt: "2026-03-04T01:00:00Z",
          attempts: 1,
          testResults: { passed: 12, failed: 0, total: 12 },
          budgetUsed: 4.23,
        },
      };
      original.servicesNeeded = [
        {
          service: "stripe",
          why: "Payment processing",
          signupUrl: "https://stripe.com",
          credentialsNeeded: ["STRIPE_KEY"],
          mockedIn: ["src/payments/"],
        },
      ];
      original.mockRegistry = {
        stripe: {
          interface: "src/stripe.ts",
          mock: "src/stripe.mock.ts",
          real: "src/stripe.real.ts",
          factory: "src/stripe.factory.ts",
          testFixtures: ["test/fixtures/stripe.json"],
          envVars: ["STRIPE_KEY"],
        },
      };
      original.skippedItems = [
        {
          requirement: "R7: WebSocket",
          phase: 4,
          attempts: [
            { approach: "ws library", error: "auth timeout" },
          ],
          codeSoFar: "src/ws/",
        },
      ];
      original.specCompliance = {
        totalRequirements: 16,
        verified: 14,
        gapHistory: [16, 5, 2],
        roundsCompleted: 3,
      };

      stateManager.save(original);
      const loaded = stateManager.load();

      expect(loaded.totalBudgetUsed).toBe(42.5);
      expect(loaded.currentWave).toBe(2);
      expect(loaded.status).toBe("wave_2");
      expect(loaded.phases["1"].status).toBe("completed");
      expect(loaded.phases["1"].testResults?.passed).toBe(12);
      expect(loaded.phases["1"].budgetUsed).toBe(4.23);
      expect(loaded.servicesNeeded[0].service).toBe("stripe");
      expect(loaded.servicesNeeded[0].signupUrl).toBe("https://stripe.com");
      expect(loaded.servicesNeeded[0].credentialsNeeded).toEqual([
        "STRIPE_KEY",
      ]);
      expect(loaded.mockRegistry.stripe.interface).toBe("src/stripe.ts");
      expect(loaded.mockRegistry.stripe.envVars).toEqual(["STRIPE_KEY"]);
      expect(loaded.skippedItems[0].requirement).toBe("R7: WebSocket");
      expect(loaded.skippedItems[0].attempts[0].approach).toBe("ws library");
      expect(loaded.specCompliance.totalRequirements).toBe(16);
      expect(loaded.specCompliance.gapHistory).toEqual([16, 5, 2]);
    });
  });

  describe("TestStateManager_Update_MutatesAndPersists_STA04", () => {
    it("STA-04: update atomically modifies and persists state", async () => {
      stateManager.initialize(tempDir);

      const updated = await stateManager.update((s) => ({
        ...s,
        totalBudgetUsed: 10.5,
        currentWave: 2,
        status: "wave_2" as const,
      }));

      expect(updated.totalBudgetUsed).toBe(10.5);
      expect(updated.currentWave).toBe(2);

      // Verify persisted
      const reloaded = stateManager.load();
      expect(reloaded.totalBudgetUsed).toBe(10.5);
      expect(reloaded.currentWave).toBe(2);
    });
  });

  describe("TestStateManager_ConcurrentUpdates_NoCorruption_STA05", () => {
    it("STA-05: concurrent writes through mutex do not corrupt data", async () => {
      stateManager.initialize(tempDir);

      // Simulate 10 concurrent updates, each incrementing budget by 1
      const updates = Array.from({ length: 10 }, (_, i) =>
        stateManager.update((s) => ({
          ...s,
          totalBudgetUsed: s.totalBudgetUsed + 1,
        })),
      );

      await Promise.all(updates);

      const final = stateManager.load();
      // All 10 updates should be applied sequentially (mutex)
      expect(final.totalBudgetUsed).toBe(10);
    });
  });

  describe("TestStateManager_ConcurrentUpdates_PhaseUpdates_STA05", () => {
    it("STA-05: concurrent phase updates don't lose data", async () => {
      stateManager.initialize(tempDir);

      // Simulate concurrent updates to different phases
      const phaseUpdates = [1, 2, 3, 4, 5].map((phaseNum) =>
        stateManager.update((s) => ({
          ...s,
          phases: {
            ...s.phases,
            [String(phaseNum)]: {
              status: "completed" as const,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              attempts: 1,
              budgetUsed: phaseNum * 2,
            },
          },
        })),
      );

      await Promise.all(phaseUpdates);

      const final = stateManager.load();
      // All 5 phases should be present
      expect(Object.keys(final.phases).length).toBe(5);
      expect(final.phases["1"].status).toBe("completed");
      expect(final.phases["5"].status).toBe("completed");
    });
  });

  describe("TestAtomicWriteSync_WritesAtomically_STA04", () => {
    it("STA-04: atomic write creates the target file", () => {
      const filePath = path.join(tempDir, "test-atomic.json");
      const content = JSON.stringify({ test: true }, null, 2);

      atomicWriteSync(filePath, content);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({
        test: true,
      });
    });

    it("STA-04: no temp files left after successful write", () => {
      const filePath = path.join(tempDir, "test-atomic.json");
      atomicWriteSync(filePath, "test content");

      const files = fs.readdirSync(tempDir);
      const tempFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tempFiles.length).toBe(0);
    });

    it("STA-04: overwrites existing file atomically", () => {
      const filePath = path.join(tempDir, "test-atomic.json");

      atomicWriteSync(filePath, '{"version": 1}');
      expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({
        version: 1,
      });

      atomicWriteSync(filePath, '{"version": 2}');
      expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({
        version: 2,
      });
    });
  });

  describe("TestStateManager_StatePath", () => {
    it("returns the correct state file path", () => {
      expect(stateManager.statePath).toBe(
        path.join(tempDir, STATE_FILE_NAME),
      );
    });
  });

  describe("TestStateManager_AllFieldsSurviveRoundTrip_STA03", () => {
    it("STA-03: all SPEC.md required fields survive save/load", () => {
      const state = createInitialState(tempDir);

      // Set every field to non-default values
      state.status = "wave_2";
      state.currentWave = 2;
      state.projectInitialized = true;
      state.scaffolded = true;
      state.totalBudgetUsed = 18.77;
      state.credentials = { STRIPE_KEY: "sk_test_123" };
      state.humanGuidance = { ws: "Use socket.io v4" };
      state.remainingGaps = ["R7", "R12"];

      stateManager.save(state);
      const loaded = stateManager.load();

      // Verify every field
      expect(loaded.projectDir).toBe(state.projectDir);
      expect(loaded.startedAt).toBe(state.startedAt);
      expect(loaded.model).toBe(state.model);
      expect(loaded.requirementsDoc).toBe(state.requirementsDoc);
      expect(loaded.status).toBe("wave_2");
      expect(loaded.currentWave).toBe(2);
      expect(loaded.projectInitialized).toBe(true);
      expect(loaded.scaffolded).toBe(true);
      expect(loaded.totalBudgetUsed).toBe(18.77);
      expect(loaded.credentials).toEqual({ STRIPE_KEY: "sk_test_123" });
      expect(loaded.humanGuidance).toEqual({ ws: "Use socket.io v4" });
      expect(loaded.remainingGaps).toEqual(["R7", "R12"]);
    });
  });
});
