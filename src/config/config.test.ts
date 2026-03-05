/**
 * Config Module Unit Tests
 *
 * Tests for forge.config.json loading, validation, and defaults.
 *
 * Requirements: CFG-01, CFG-02, CFG-03
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadConfig,
  getDefaultConfig,
  ConfigValidationError,
  CONFIG_FILE_NAME,
} from "./index.js";

/**
 * Helper to create a temp directory for test isolation.
 */
function createTempDir(): string {
  const dir = path.join("/tmp", `forge-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Config Module", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("TestLoadConfig_MissingFile_ReturnsDefaults", () => {
    it("CFG-01: returns all defaults when config file is missing", () => {
      const config = loadConfig(tempDir);

      expect(config.model).toBe("claude-opus-4-6");
      expect(config.maxBudgetTotal).toBe(200.0);
      expect(config.maxBudgetPerStep).toBe(15.0);
      expect(config.maxRetries).toBe(3);
      expect(config.maxComplianceRounds).toBe(5);
      expect(config.maxTurnsPerStep).toBe(200);
    });
  });

  describe("TestLoadConfig_EmptyObject_ReturnsDefaults", () => {
    it("CFG-02: empty {} config is valid and returns all defaults", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({}),
      );

      const config = loadConfig(tempDir);

      expect(config.model).toBe("claude-opus-4-6");
      expect(config.maxBudgetTotal).toBe(200.0);
      expect(config.maxRetries).toBe(3);
      expect(config.testing.stack).toBe("node");
      expect(config.verification.typecheck).toBe(true);
      expect(config.parallelism.maxConcurrentPhases).toBe(3);
    });
  });

  describe("TestLoadConfig_PartialConfig_MergesWithDefaults", () => {
    it("CFG-02: partial config is merged with defaults for missing fields", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_budget_total: 500.0,
        }),
      );

      const config = loadConfig(tempDir);

      // Overridden values
      expect(config.model).toBe("claude-sonnet-4-5-20250929");
      expect(config.maxBudgetTotal).toBe(500.0);

      // Defaulted values
      expect(config.maxBudgetPerStep).toBe(15.0);
      expect(config.maxRetries).toBe(3);
      expect(config.testing.stack).toBe("node");
    });
  });

  describe("TestLoadConfig_FullConfig_AllFieldsLoaded", () => {
    it("CFG-03: all config options from spec are supported", () => {
      const fullConfig = {
        model: "claude-opus-4-6",
        max_budget_total: 300.0,
        max_budget_per_step: 20.0,
        max_retries: 5,
        max_compliance_rounds: 10,
        max_turns_per_step: 150,
        testing: {
          stack: "python",
          unit_command: "pytest --json-report",
          integration_command: "pytest test/integration",
          scenario_command: "pytest test/e2e",
          docker_compose_file: "docker-compose.ci.yml",
        },
        verification: {
          typecheck: false,
          lint: true,
          docker_smoke: false,
          test_coverage_check: true,
          observability_check: false,
        },
        notion: {
          parent_page_id: "abc-123",
          doc_pages: {
            architecture: "arch-page",
            data_flow: "df-page",
            api_reference: "api-page",
            component_index: "comp-page",
            adrs: "adr-page",
            deployment: "deploy-page",
            dev_workflow: "dev-page",
            phase_reports: "reports-page",
          },
        },
        parallelism: {
          max_concurrent_phases: 5,
          enable_subagents: false,
          background_docs: false,
        },
        deployment: {
          target: "aws",
          environments: ["dev", "prod"],
        },
        notifications: {
          on_human_needed: "webhook",
          on_phase_complete: "slack",
          on_failure: "webhook",
        },
      };

      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify(fullConfig, null, 2),
      );

      const config = loadConfig(tempDir);

      // Core fields
      expect(config.model).toBe("claude-opus-4-6");
      expect(config.maxBudgetTotal).toBe(300.0);
      expect(config.maxBudgetPerStep).toBe(20.0);
      expect(config.maxRetries).toBe(5);
      expect(config.maxComplianceRounds).toBe(10);
      expect(config.maxTurnsPerStep).toBe(150);

      // Testing (camelCase mapping)
      expect(config.testing.stack).toBe("python");
      expect(config.testing.unitCommand).toBe("pytest --json-report");
      expect(config.testing.integrationCommand).toBe("pytest test/integration");
      expect(config.testing.scenarioCommand).toBe("pytest test/e2e");
      expect(config.testing.dockerComposeFile).toBe("docker-compose.ci.yml");

      // Verification
      expect(config.verification.typecheck).toBe(false);
      expect(config.verification.lint).toBe(true);
      expect(config.verification.dockerSmoke).toBe(false);
      expect(config.verification.testCoverageCheck).toBe(true);
      expect(config.verification.observabilityCheck).toBe(false);

      // Notion
      expect(config.notion.parentPageId).toBe("abc-123");
      expect(config.notion.docPages.architecture).toBe("arch-page");
      expect(config.notion.docPages.dataFlow).toBe("df-page");
      expect(config.notion.docPages.apiReference).toBe("api-page");
      expect(config.notion.docPages.componentIndex).toBe("comp-page");
      expect(config.notion.docPages.adrs).toBe("adr-page");
      expect(config.notion.docPages.deployment).toBe("deploy-page");
      expect(config.notion.docPages.devWorkflow).toBe("dev-page");
      expect(config.notion.docPages.phaseReports).toBe("reports-page");

      // Parallelism
      expect(config.parallelism.maxConcurrentPhases).toBe(5);
      expect(config.parallelism.enableSubagents).toBe(false);
      expect(config.parallelism.backgroundDocs).toBe(false);

      // Deployment
      expect(config.deployment.target).toBe("aws");
      expect(config.deployment.environments).toEqual(["dev", "prod"]);

      // Notifications
      expect(config.notifications.onHumanNeeded).toBe("webhook");
      expect(config.notifications.onPhaseComplete).toBe("slack");
      expect(config.notifications.onFailure).toBe("webhook");
    });
  });

  describe("TestLoadConfig_InvalidJSON_ThrowsConfigValidationError", () => {
    it("CFG-02: throws ConfigValidationError for invalid JSON", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        "not valid json {{{",
      );

      expect(() => loadConfig(tempDir)).toThrow(ConfigValidationError);
      expect(() => loadConfig(tempDir)).toThrow("Invalid JSON");
    });
  });

  describe("TestLoadConfig_InvalidValues_ThrowsWithFieldDetail", () => {
    it("CFG-02: throws ConfigValidationError with field-level detail for invalid values", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({
          max_budget_total: -100, // min(0)
        }),
      );

      try {
        loadConfig(tempDir);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const validationError = error as ConfigValidationError;
        expect(validationError.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("TestLoadConfig_WrongTypes_ThrowsWithFieldDetail", () => {
    it("CFG-02: throws ConfigValidationError when field types are wrong", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({
          model: 12345, // should be string
        }),
      );

      try {
        loadConfig(tempDir);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const validationError = error as ConfigValidationError;
        expect(validationError.issues.length).toBeGreaterThan(0);
        // Should mention the field path
        expect(
          validationError.issues.some(
            (i) => i.path.includes("model") || i.message.includes("string"),
          ),
        ).toBe(true);
      }
    });
  });

  describe("TestLoadConfig_NestedDefaults_CFG03", () => {
    it("CFG-03: nested objects get their own defaults when parent is partially specified", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({
          testing: { stack: "go" },
          // verification, parallelism, etc. should get defaults
        }),
      );

      const config = loadConfig(tempDir);

      // Partially specified testing
      expect(config.testing.stack).toBe("go");
      expect(config.testing.unitCommand).toBe("npm test -- --json"); // default

      // Fully defaulted sections
      expect(config.verification.typecheck).toBe(true);
      expect(config.verification.lint).toBe(true);
      expect(config.parallelism.maxConcurrentPhases).toBe(3);
    });
  });

  describe("TestGetDefaultConfig", () => {
    it("returns a fully populated default config", () => {
      const config = getDefaultConfig();

      // Should have all required fields
      expect(config.model).toBeDefined();
      expect(config.maxBudgetTotal).toBeDefined();
      expect(config.testing).toBeDefined();
      expect(config.verification).toBeDefined();
      expect(config.notion).toBeDefined();
      expect(config.parallelism).toBeDefined();
      expect(config.deployment).toBeDefined();
      expect(config.notifications).toBeDefined();

      // Nested defaults
      expect(config.notion.docPages).toBeDefined();
      expect(config.testing.unitCommand).toBeDefined();
    });
  });

  describe("TestLoadConfig_CamelCaseMapping_CFG02", () => {
    it("CFG-02: snake_case JSON keys are mapped to camelCase TypeScript properties", () => {
      fs.writeFileSync(
        path.join(tempDir, CONFIG_FILE_NAME),
        JSON.stringify({
          max_budget_total: 100,
          max_budget_per_step: 10,
          max_turns_per_step: 50,
          testing: {
            unit_command: "jest",
            integration_command: "jest --integration",
            docker_compose_file: "dc.yml",
          },
        }),
      );

      const config = loadConfig(tempDir);

      // Verify camelCase mapping for top-level fields
      expect(config.maxBudgetTotal).toBe(100);
      expect(config.maxBudgetPerStep).toBe(10);
      expect(config.maxTurnsPerStep).toBe(50);

      // Verify camelCase mapping for nested fields
      expect(config.testing.unitCommand).toBe("jest");
      expect(config.testing.integrationCommand).toBe("jest --integration");
      expect(config.testing.dockerComposeFile).toBe("dc.yml");
    });
  });
});
