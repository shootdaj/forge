/**
 * Maestro UAT Execution Module
 *
 * Runs Maestro flows against a Flutter app on the Android emulator,
 * parses JUnit XML results via junit2json, and implements defense-in-depth
 * result reconciliation (exit code AND XML content cross-check).
 *
 * Requirements: MAE-01, MAE-02
 */

import * as nodeFs from "node:fs";
import { execSync } from "node:child_process";
import { parse as parseJUnit } from "junit2json";
import type {
  MaestroResult,
  MaestroFlowResult,
  MaestroTestOptions,
} from "./maestro-types.js";
import type { WorkflowResult } from "./types.js";

// ---------------------------------------------------------------------------
// Default injectable functions
// ---------------------------------------------------------------------------

const defaultExecFn = (cmd: string): string =>
  execSync(cmd, { encoding: "utf-8" });

// ---------------------------------------------------------------------------
// JUnit XML types from junit2json
// ---------------------------------------------------------------------------

interface JUnitTestcase {
  name?: string;
  classname?: string;
  time?: number;
  failure?: Array<{ message?: string; inner?: string }>;
  error?: Array<{ message?: string; inner?: string }>;
}

interface JUnitTestsuite {
  name?: string;
  tests?: number;
  failures?: number;
  time?: number;
  testcase?: JUnitTestcase[];
}

interface JUnitReport {
  testsuite?: JUnitTestsuite[];
}

// ---------------------------------------------------------------------------
// Maestro test execution
// ---------------------------------------------------------------------------

/**
 * Run `maestro test` CLI command and capture exit code + report path.
 *
 * Constructs the command: `maestro test --format junit --output <path> [--device <serial>] <flowsDir>`
 *
 * Requirement: MAE-01
 *
 * @param options - Maestro test configuration
 * @returns Object with exitCode and reportPath
 */
export function runMaestroTest(
  options: MaestroTestOptions,
): { exitCode: number; reportPath: string } {
  const execFn = options.execFn ?? defaultExecFn;
  const outputPath = options.outputPath ?? ".forge/maestro-report.xml";

  const cmdParts = ["maestro", "test", "--format", "junit", "--output", outputPath];

  if (options.serial) {
    cmdParts.push("--device", options.serial);
  }

  cmdParts.push(options.flowsDir);

  const cmd = cmdParts.join(" ");

  try {
    execFn(cmd);
    return { exitCode: 0, reportPath: outputPath };
  } catch (err: unknown) {
    // Extract exit code from exec error
    const exitCode =
      err && typeof err === "object" && "status" in err
        ? (err as { status: number }).status
        : 1;
    return { exitCode, reportPath: outputPath };
  }
}

// ---------------------------------------------------------------------------
// JUnit XML parsing
// ---------------------------------------------------------------------------

/**
 * Parse JUnit XML content into a MaestroResult.
 *
 * Uses junit2json to parse the XML, then maps testcase elements to
 * MaestroFlowResult objects.
 *
 * Requirement: MAE-01
 *
 * @param xmlContent - Raw JUnit XML string
 * @returns MaestroResult with flow-level results
 */
export async function parseMaestroJUnit(
  xmlContent: string,
): Promise<MaestroResult> {
  const report = (await parseJUnit(xmlContent)) as JUnitReport;

  const flowResults: MaestroFlowResult[] = [];

  const testsuites = report.testsuite ?? [];
  for (const suite of testsuites) {
    const testcases = suite.testcase ?? [];
    for (const tc of testcases) {
      const hasFailure =
        (tc.failure && tc.failure.length > 0) ||
        (tc.error && tc.error.length > 0);

      const errorMsg =
        tc.failure?.[0]?.message ??
        tc.error?.[0]?.message ??
        undefined;

      flowResults.push({
        name: tc.name ?? tc.classname ?? "unknown",
        passed: !hasFailure,
        durationMs: (tc.time ?? 0) * 1000,
        error: errorMsg,
      });
    }
  }

  const passedFlows = flowResults.filter((f) => f.passed).length;
  const failedFlows = flowResults.filter((f) => !f.passed).length;

  return {
    passed: failedFlows === 0 && flowResults.length > 0,
    totalFlows: flowResults.length,
    passedFlows,
    failedFlows,
    flowResults,
  };
}

// ---------------------------------------------------------------------------
// Defense-in-depth reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile Maestro exit code with JUnit XML parsing result.
 *
 * Defense-in-depth: exit code and XML may disagree due to known
 * Maestro regression (mobile-dev-inc/maestro#2706). When they disagree,
 * trust the XML content over the exit code.
 *
 * Reconciliation matrix:
 * - exit=0, XML=pass → PASS
 * - exit=0, XML=fail → FAIL (trust XML over exit code)
 * - exit≠0, XML=pass → PASS (known regression — trust XML)
 * - exit≠0, XML=fail → FAIL
 *
 * Requirement: MAE-02
 *
 * @param exitCode - Exit code from maestro test CLI
 * @param junitResult - Parsed result from JUnit XML
 * @returns Reconciled MaestroResult (always trust XML)
 */
export function reconcileResult(
  exitCode: number,
  junitResult: MaestroResult,
): MaestroResult {
  // Always trust the XML content — it has per-flow granularity.
  // The exit code is only used as a fallback when XML is unavailable.
  // Known Maestro regression: exit code 1 even when all flows pass.
  return junitResult;
}

// ---------------------------------------------------------------------------
// High-level execution
// ---------------------------------------------------------------------------

/**
 * Execute Maestro UAT end-to-end: run test, parse results, reconcile.
 *
 * High-level function that orchestrates:
 * 1. Run `maestro test --format junit`
 * 2. Read JUnit XML report from filesystem
 * 3. Parse XML into MaestroResult
 * 4. Reconcile exit code with XML result
 *
 * Requirements: MAE-01, MAE-02
 *
 * @param options - Maestro test configuration
 * @param fs - Injectable filesystem for testing
 * @returns Reconciled MaestroResult
 */
export async function executeMaestroUAT(
  options: MaestroTestOptions,
  fs?: {
    readFileSync: (path: string, encoding: string) => string;
    existsSync: (path: string) => boolean;
  },
): Promise<MaestroResult> {
  const fileSystem = fs ?? nodeFs;

  // 1. Run maestro test
  const { exitCode, reportPath } = runMaestroTest(options);

  // 2. Read JUnit report
  if (!fileSystem.existsSync(reportPath)) {
    return {
      passed: false,
      totalFlows: 0,
      passedFlows: 0,
      failedFlows: 1,
      flowResults: [
        {
          name: "maestro-test",
          passed: false,
          durationMs: 0,
          error: "JUnit report not generated at " + reportPath,
        },
      ],
    };
  }

  let xmlContent: string;
  try {
    xmlContent = fileSystem.readFileSync(reportPath, "utf-8");
  } catch {
    return {
      passed: false,
      totalFlows: 0,
      passedFlows: 0,
      failedFlows: 1,
      flowResults: [
        {
          name: "maestro-test",
          passed: false,
          durationMs: 0,
          error: "Failed to read JUnit report: " + reportPath,
        },
      ],
    };
  }

  // 3. Parse JUnit XML
  let junitResult: MaestroResult;
  try {
    junitResult = await parseMaestroJUnit(xmlContent);
  } catch {
    // XML parse failed — fall back to exit code only
    return {
      passed: exitCode === 0,
      totalFlows: 0,
      passedFlows: exitCode === 0 ? 1 : 0,
      failedFlows: exitCode === 0 ? 0 : 1,
      flowResults: [
        {
          name: "maestro-test",
          passed: exitCode === 0,
          durationMs: 0,
          error:
            exitCode !== 0
              ? `Maestro exited with code ${exitCode} (XML unparseable)`
              : undefined,
        },
      ],
    };
  }

  // 4. Reconcile exit code with XML
  return reconcileResult(exitCode, junitResult);
}

// ---------------------------------------------------------------------------
// WorkflowResult conversion
// ---------------------------------------------------------------------------

/**
 * Convert MaestroResult to WorkflowResult[] for gap closure compatibility.
 *
 * Maps each Maestro flow to the existing WorkflowResult type used by
 * runUATGapClosure() in workflows.ts.
 *
 * Requirement: MAE-06
 *
 * @param result - MaestroResult from executeMaestroUAT
 * @returns Array of WorkflowResult objects
 */
export function maestroResultToWorkflowResults(
  result: MaestroResult,
): WorkflowResult[] {
  return result.flowResults.map((flow) => ({
    workflowId: `maestro-${flow.name}`,
    passed: flow.passed,
    stepsPassed: flow.passed ? 1 : 0,
    stepsFailed: flow.passed ? 0 : 1,
    errors: flow.error ? [flow.error] : [],
    durationMs: flow.durationMs,
  }));
}
