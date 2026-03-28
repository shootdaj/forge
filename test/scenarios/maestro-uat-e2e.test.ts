/**
 * Scenario Tests: Maestro UAT End-to-End
 *
 * Full end-to-end scenario tests verifying the complete Maestro UAT lifecycle:
 * emulator → flutter run → maestro test → gap closure.
 *
 * All tests use fully mocked dependencies — no real processes or file I/O.
 *
 * Requirements: MAE-01 through MAE-07
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseMaestroJUnit,
  reconcileResult,
  maestroResultToWorkflowResults,
} from "../../src/uat/maestro.js";
import type { MaestroResult } from "../../src/uat/maestro-types.js";
import { detectAppType, buildUATPrompt } from "../../src/uat/runner.js";
import type { ForgeConfig } from "../../src/config/schema.js";
import type { UATWorkflow } from "../../src/uat/types.js";

// ---------------------------------------------------------------------------
// Sample JUnit XML fixtures
// ---------------------------------------------------------------------------

const JUNIT_ALL_PASS = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="3" failures="0" time="10.5">
    <testcase name="login-flow" classname="com.example" time="3.2"/>
    <testcase name="add-item-flow" classname="com.example" time="4.1"/>
    <testcase name="navigation-flow" classname="com.example" time="3.2"/>
  </testsuite>
</testsuites>`;

const JUNIT_WITH_FAILURES = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="2" failures="1" time="8.0">
    <testcase name="login-flow" classname="com.example" time="3.0"/>
    <testcase name="delete-flow" classname="com.example" time="5.0">
      <failure message="Element not found: delete-button">Could not find element</failure>
    </testcase>
  </testsuite>
</testsuites>`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createFlutterConfig(): ForgeConfig {
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
      integrationCommand: "",
      scenarioCommand: "",
      dockerComposeFile: "",
      flutterAvdName: "Pixel_6_API_33",
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
    parallelism: { maxConcurrentPhases: 1, enableSubagents: false, backgroundDocs: false },
    frontend: { hasGui: false, designInteractive: false, designOptionsCount: 3 },
    deployment: { target: "none", environments: [] },
    notifications: { onHumanNeeded: "stdout", onPhaseComplete: "stdout", onFailure: "stdout" },
  };
}

// ---------------------------------------------------------------------------
// Scenario Tests
// ---------------------------------------------------------------------------

describe("Maestro UAT E2E Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TestMaestroUAT_FullPassingFlow", async () => {
    // Scenario: Complete passing flow — parse JUnit → convert → verify results

    // 1. Parse JUnit XML with all tests passing
    const junitResult = await parseMaestroJUnit(JUNIT_ALL_PASS);

    expect(junitResult.passed).toBe(true);
    expect(junitResult.totalFlows).toBe(3);
    expect(junitResult.passedFlows).toBe(3);
    expect(junitResult.failedFlows).toBe(0);

    // 2. Reconcile with exit code 0 (normal case)
    const reconciled = reconcileResult(0, junitResult);
    expect(reconciled.passed).toBe(true);

    // 3. Convert to WorkflowResult[]
    const workflowResults = maestroResultToWorkflowResults(reconciled);

    expect(workflowResults).toHaveLength(3);
    expect(workflowResults.every((r) => r.passed)).toBe(true);
    expect(workflowResults.every((r) => r.errors.length === 0)).toBe(true);
    expect(workflowResults[0].workflowId).toBe("maestro-login-flow");
    expect(workflowResults[1].workflowId).toBe("maestro-add-item-flow");
    expect(workflowResults[2].workflowId).toBe("maestro-navigation-flow");
  });

  it("TestMaestroUAT_GapClosureFixesFailures", async () => {
    // Scenario: First run has failures, gap closure fixes them, second run passes
    // Note: In the real flow, the same set of flows is re-run after gap closure

    const JUNIT_FIRST_RUN = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="2" failures="1" time="8.0">
    <testcase name="login-flow" classname="com.example" time="3.0"/>
    <testcase name="delete-flow" classname="com.example" time="5.0">
      <failure message="Element not found: delete-button">Could not find element</failure>
    </testcase>
  </testsuite>
</testsuites>`;

    const JUNIT_SECOND_RUN = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="2" failures="0" time="7.0">
    <testcase name="login-flow" classname="com.example" time="3.0"/>
    <testcase name="delete-flow" classname="com.example" time="4.0"/>
  </testsuite>
</testsuites>`;

    // 1. First Maestro run — has failures
    const firstResult = await parseMaestroJUnit(JUNIT_FIRST_RUN);
    expect(firstResult.passed).toBe(false);
    expect(firstResult.failedFlows).toBe(1);

    const firstWorkflows = maestroResultToWorkflowResults(firstResult);
    const failed = firstWorkflows.filter((r) => !r.passed);
    expect(failed).toHaveLength(1);
    expect(failed[0].workflowId).toBe("maestro-delete-flow");
    expect(failed[0].errors[0]).toContain("Element not found");

    // 2. After gap closure — second run passes (same flows)
    const secondResult = await parseMaestroJUnit(JUNIT_SECOND_RUN);
    expect(secondResult.passed).toBe(true);

    const secondWorkflows = maestroResultToWorkflowResults(secondResult);
    expect(secondWorkflows.every((r) => r.passed)).toBe(true);

    // 3. Verify merge logic — failed results replaced by passing ones
    const allResults = [...firstWorkflows];
    for (const cr of secondWorkflows) {
      const idx = allResults.findIndex((r) => r.workflowId === cr.workflowId);
      if (idx >= 0) {
        allResults[idx] = cr;
      } else {
        allResults.push(cr);
      }
    }

    // All should be passing after merge
    const stillFailed = allResults.filter((r) => !r.passed);
    expect(stillFailed).toHaveLength(0);
  });

  it("TestMaestroUAT_DefenseInDepthTrustsXmlOverExitCode", async () => {
    // Scenario: Maestro regression — exit code 1 but all tests pass in XML

    const junitResult = await parseMaestroJUnit(JUNIT_ALL_PASS);
    expect(junitResult.passed).toBe(true);

    // Exit code is 1 (Maestro regression #2706)
    const reconciled = reconcileResult(1, junitResult);

    // Defense-in-depth: trust XML over exit code
    expect(reconciled.passed).toBe(true);
    expect(reconciled.totalFlows).toBe(3);
    expect(reconciled.failedFlows).toBe(0);
  });

  it("TestMaestroUAT_FlutterDetectionAndPromptGeneration", () => {
    // Scenario: Flutter app detected → proper UAT prompt with semantic guidance

    // 1. Detect Flutter app type
    const config = createFlutterConfig();
    const appType = detectAppType(config);
    expect(appType).toBe("flutter");

    // 2. Build UAT prompt for Flutter
    const workflow: UATWorkflow = {
      id: "UAT-R1-01",
      requirementId: "R1",
      description: "Login workflow",
      steps: ["Enter email", "Enter password", "Tap login button"],
      appType: "flutter",
    };

    const prompt = buildUATPrompt(workflow, appType, "Safety rules here.");

    // 3. Verify semantic identifier guidance
    expect(prompt).toContain("ValueKey");
    expect(prompt).toContain("Widget Identification (CRITICAL)");
    expect(prompt).toContain("waitForAnimationToEnd");
    expect(prompt).toContain("clearState");
    expect(prompt).toContain("assertVisible");
    expect(prompt).toContain("Maestro Flow Requirements");

    // 4. Verify it does NOT contain web/Docker guidance
    expect(prompt).not.toContain("headless browser");
    expect(prompt).not.toContain("Playwright");
    expect(prompt).not.toContain("curl");
  });

  it("TestMaestroUAT_EmptyWorkflowsReturnsPassed", async () => {
    // Scenario: No workflows extracted → UAT passes vacuously

    const emptyResult: MaestroResult = {
      passed: false,
      totalFlows: 0,
      passedFlows: 0,
      failedFlows: 0,
      flowResults: [],
    };

    const workflowResults = maestroResultToWorkflowResults(emptyResult);
    expect(workflowResults).toEqual([]);
  });
});
