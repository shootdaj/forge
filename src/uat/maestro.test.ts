/**
 * Unit Tests: Maestro UAT Execution
 *
 * Tests for runMaestroTest, parseMaestroJUnit, reconcileResult,
 * executeMaestroUAT, and maestroResultToWorkflowResults.
 *
 * All tests use mock execFn and fs — no real Maestro CLI executed.
 *
 * Requirements: MAE-01, MAE-02, MAE-06
 */

import { describe, it, expect, vi } from "vitest";
import {
  runMaestroTest,
  parseMaestroJUnit,
  reconcileResult,
  executeMaestroUAT,
  maestroResultToWorkflowResults,
} from "./maestro.js";
import type { MaestroResult } from "./maestro-types.js";

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
  <testsuite name="Maestro" tests="3" failures="1" time="12.5">
    <testcase name="login-flow" classname="com.example" time="4.2"/>
    <testcase name="add-item-flow" classname="com.example" time="3.1"/>
    <testcase name="delete-flow" classname="com.example" time="5.2">
      <failure message="Element not found: delete-button">Could not find element with id: delete-button</failure>
    </testcase>
  </testsuite>
</testsuites>`;

const JUNIT_ALL_FAIL = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="2" failures="2" time="5.0">
    <testcase name="flow1" classname="com.x" time="2.5">
      <failure message="Timeout">Timed out</failure>
    </testcase>
    <testcase name="flow2" classname="com.x" time="2.5">
      <failure message="Not visible">Element not visible</failure>
    </testcase>
  </testsuite>
</testsuites>`;

const JUNIT_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Maestro" tests="0" failures="0" time="0">
  </testsuite>
</testsuites>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("maestro", () => {
  // =========================================================================
  // runMaestroTest
  // =========================================================================

  describe("runMaestroTest", () => {
    it("TestMaestro_RunConstructsCorrectCommand", () => {
      const execFn = vi.fn().mockReturnValue("");
      runMaestroTest({ flowsDir: ".maestro", execFn });

      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining("maestro test --format junit --output"),
      );
      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining(".maestro"),
      );
    });

    it("TestMaestro_RunWithSerial", () => {
      const execFn = vi.fn().mockReturnValue("");
      runMaestroTest({
        flowsDir: ".maestro",
        serial: "emulator-5554",
        execFn,
      });

      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining("--device emulator-5554"),
      );
    });

    it("TestMaestro_RunReturnsExitCodeZero", () => {
      const execFn = vi.fn().mockReturnValue("");
      const result = runMaestroTest({ flowsDir: ".maestro", execFn });

      expect(result.exitCode).toBe(0);
      expect(result.reportPath).toContain("maestro-report.xml");
    });

    it("TestMaestro_RunReturnsExitCodeOnFailure", () => {
      const execFn = vi.fn().mockImplementation(() => {
        const err = new Error("Command failed") as Error & { status: number };
        err.status = 1;
        throw err;
      });

      const result = runMaestroTest({ flowsDir: ".maestro", execFn });

      expect(result.exitCode).toBe(1);
      expect(result.reportPath).toContain("maestro-report.xml");
    });

    it("TestMaestro_RunWithCustomOutputPath", () => {
      const execFn = vi.fn().mockReturnValue("");
      const result = runMaestroTest({
        flowsDir: ".maestro",
        outputPath: "/tmp/report.xml",
        execFn,
      });

      expect(execFn).toHaveBeenCalledWith(
        expect.stringContaining("--output /tmp/report.xml"),
      );
      expect(result.reportPath).toBe("/tmp/report.xml");
    });
  });

  // =========================================================================
  // parseMaestroJUnit
  // =========================================================================

  describe("parseMaestroJUnit", () => {
    it("TestMaestro_ParseValidJUnit_AllPass", async () => {
      const result = await parseMaestroJUnit(JUNIT_ALL_PASS);

      expect(result.passed).toBe(true);
      expect(result.totalFlows).toBe(3);
      expect(result.passedFlows).toBe(3);
      expect(result.failedFlows).toBe(0);
      expect(result.flowResults).toHaveLength(3);
      expect(result.flowResults[0].name).toBe("login-flow");
      expect(result.flowResults[0].passed).toBe(true);
      expect(result.flowResults[0].durationMs).toBeCloseTo(3200, -1);
    });

    it("TestMaestro_ParseWithFailures", async () => {
      const result = await parseMaestroJUnit(JUNIT_WITH_FAILURES);

      expect(result.passed).toBe(false);
      expect(result.totalFlows).toBe(3);
      expect(result.passedFlows).toBe(2);
      expect(result.failedFlows).toBe(1);

      const failed = result.flowResults.find((f) => !f.passed);
      expect(failed).toBeDefined();
      expect(failed!.name).toBe("delete-flow");
      expect(failed!.error).toContain("Element not found");
    });

    it("TestMaestro_ParseExtractsErrorMessages", async () => {
      const result = await parseMaestroJUnit(JUNIT_ALL_FAIL);

      expect(result.failedFlows).toBe(2);
      expect(result.flowResults[0].error).toBe("Timeout");
      expect(result.flowResults[1].error).toBe("Not visible");
    });

    it("TestMaestro_ParseEmptyTestsuite", async () => {
      const result = await parseMaestroJUnit(JUNIT_EMPTY);

      expect(result.totalFlows).toBe(0);
      expect(result.passedFlows).toBe(0);
      expect(result.failedFlows).toBe(0);
      // Empty testsuite is not "passed" — no flows ran
      expect(result.passed).toBe(false);
    });
  });

  // =========================================================================
  // reconcileResult
  // =========================================================================

  describe("reconcileResult", () => {
    const passingResult: MaestroResult = {
      passed: true,
      totalFlows: 2,
      passedFlows: 2,
      failedFlows: 0,
      flowResults: [
        { name: "f1", passed: true, durationMs: 1000 },
        { name: "f2", passed: true, durationMs: 2000 },
      ],
    };

    const failingResult: MaestroResult = {
      passed: false,
      totalFlows: 2,
      passedFlows: 1,
      failedFlows: 1,
      flowResults: [
        { name: "f1", passed: true, durationMs: 1000 },
        { name: "f2", passed: false, durationMs: 2000, error: "Not found" },
      ],
    };

    it("TestMaestro_ReconcileExitZeroXmlPass", () => {
      const result = reconcileResult(0, passingResult);
      expect(result.passed).toBe(true);
    });

    it("TestMaestro_ReconcileExitZeroXmlFail", () => {
      // Trust XML over exit code
      const result = reconcileResult(0, failingResult);
      expect(result.passed).toBe(false);
    });

    it("TestMaestro_ReconcileExitOneXmlPass", () => {
      // Known Maestro regression — trust XML over exit code
      const result = reconcileResult(1, passingResult);
      expect(result.passed).toBe(true);
    });

    it("TestMaestro_ReconcileExitOneXmlFail", () => {
      const result = reconcileResult(1, failingResult);
      expect(result.passed).toBe(false);
    });
  });

  // =========================================================================
  // maestroResultToWorkflowResults
  // =========================================================================

  describe("maestroResultToWorkflowResults", () => {
    it("TestMaestro_ConvertPassingResults", () => {
      const maestroResult: MaestroResult = {
        passed: true,
        totalFlows: 2,
        passedFlows: 2,
        failedFlows: 0,
        flowResults: [
          { name: "login-flow", passed: true, durationMs: 3000 },
          { name: "nav-flow", passed: true, durationMs: 2000 },
        ],
      };

      const results = maestroResultToWorkflowResults(maestroResult);

      expect(results).toHaveLength(2);
      expect(results[0].workflowId).toBe("maestro-login-flow");
      expect(results[0].passed).toBe(true);
      expect(results[0].stepsPassed).toBe(1);
      expect(results[0].stepsFailed).toBe(0);
      expect(results[0].errors).toEqual([]);
      expect(results[0].durationMs).toBe(3000);
    });

    it("TestMaestro_ConvertFailedResults", () => {
      const maestroResult: MaestroResult = {
        passed: false,
        totalFlows: 1,
        passedFlows: 0,
        failedFlows: 1,
        flowResults: [
          {
            name: "delete-flow",
            passed: false,
            durationMs: 5000,
            error: "Element not found: delete-button",
          },
        ],
      };

      const results = maestroResultToWorkflowResults(maestroResult);

      expect(results).toHaveLength(1);
      expect(results[0].workflowId).toBe("maestro-delete-flow");
      expect(results[0].passed).toBe(false);
      expect(results[0].stepsPassed).toBe(0);
      expect(results[0].stepsFailed).toBe(1);
      expect(results[0].errors).toEqual(["Element not found: delete-button"]);
    });

    it("TestMaestro_ConvertEmptyResults", () => {
      const maestroResult: MaestroResult = {
        passed: false,
        totalFlows: 0,
        passedFlows: 0,
        failedFlows: 0,
        flowResults: [],
      };

      const results = maestroResultToWorkflowResults(maestroResult);
      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // executeMaestroUAT
  // =========================================================================

  describe("executeMaestroUAT", () => {
    it("TestMaestro_ExecuteEndToEnd", async () => {
      const execFn = vi.fn().mockReturnValue("");
      const mockFs = {
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(JUNIT_ALL_PASS),
      };

      const result = await executeMaestroUAT(
        { flowsDir: ".maestro", execFn },
        mockFs,
      );

      expect(result.passed).toBe(true);
      expect(result.totalFlows).toBe(3);
      expect(result.passedFlows).toBe(3);
    });

    it("TestMaestro_ExecuteMissingReport", async () => {
      const execFn = vi.fn().mockReturnValue("");
      const mockFs = {
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
      };

      const result = await executeMaestroUAT(
        { flowsDir: ".maestro", execFn },
        mockFs,
      );

      expect(result.passed).toBe(false);
      expect(result.failedFlows).toBe(1);
      expect(result.flowResults[0].error).toContain("JUnit report not generated");
    });

    it("TestMaestro_ExecuteWithExitCodeOneButPassingXml", async () => {
      const execFn = vi.fn().mockImplementation(() => {
        const err = new Error("exit 1") as Error & { status: number };
        err.status = 1;
        throw err;
      });
      const mockFs = {
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(JUNIT_ALL_PASS),
      };

      // Defense-in-depth: trust XML over exit code
      const result = await executeMaestroUAT(
        { flowsDir: ".maestro", execFn },
        mockFs,
      );

      expect(result.passed).toBe(true);
      expect(result.totalFlows).toBe(3);
    });
  });
});
