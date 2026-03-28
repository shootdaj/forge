/**
 * Flutter Test Verifier (FV-03)
 *
 * Runs flutter test --machine, parses NDJSON events, filters Gradle
 * contamination from stdout.
 * Self-skips when pubspec.yaml is absent.
 * Acquires Flutter startup lock before running.
 *
 * Requirement: FV-03, FV-05, FV-06
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";
import { withFlutterLock } from "./flutter-lock.js";

/**
 * Verify that Flutter tests pass.
 *
 * Runs `flutter test --machine` and parses the NDJSON event stream.
 * Filters non-JSON lines (Gradle contamination: flutter/flutter#123873).
 * Falls back to exit code if no NDJSON done event is found.
 *
 * @param config - Verifier configuration with cwd and forgeConfig
 * @returns VerifierResult indicating pass, fail, or skip
 */
export const flutterTestVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("flutter-test", "No pubspec.yaml found");
  }

  // Check if test directory exists
  const testDir = path.resolve(config.cwd, "test");
  if (!fs.existsSync(testDir)) {
    return skippedResult("flutter-test", "No test/ directory found");
  }

  const result = await withFlutterLock(() =>
    execWithTimeout("flutter test --machine", config.cwd, 120_000),
  );

  const parsed = parseNdjsonOutput(result.stdout);

  if (parsed.doneEvent !== null) {
    if (parsed.doneEvent.success) {
      return {
        passed: true,
        verifier: "flutter-test",
        details: [`flutter test passed: ${parsed.passCount} passed, ${parsed.failCount} failed`],
        errors: [],
      };
    }

    return {
      passed: false,
      verifier: "flutter-test",
      details: [`flutter test failed: ${parsed.passCount} passed, ${parsed.failCount} failed`],
      errors: parsed.failedTestNames.slice(0, 20),
    };
  }

  // No done event found — fall back to exit code
  const passed = result.exitCode === 0;
  return {
    passed,
    verifier: "flutter-test",
    details: [`flutter test exited with code ${result.exitCode} (no NDJSON done event)`],
    errors: passed ? [] : (result.stderr || result.stdout).trim().split("\n").slice(0, 20),
  };
};

export interface NdjsonParseResult {
  doneEvent: { success: boolean } | null;
  passCount: number;
  failCount: number;
  failedTestNames: string[];
}

/**
 * Parse NDJSON output from flutter test --machine.
 * Filters non-JSON lines (Gradle contamination: flutter/flutter#123873).
 *
 * Event types handled:
 * - testStart: records test name by ID
 * - testDone: increments pass/fail counts
 * - done: overall success/failure flag
 *
 * @param stdout - Raw stdout from flutter test --machine
 * @returns Parsed results with done event, counts, and failed test names
 */
export function parseNdjsonOutput(stdout: string): NdjsonParseResult {
  let doneEvent: { success: boolean } | null = null;
  let passCount = 0;
  let failCount = 0;
  const failedTestNames: string[] = [];

  // Map testID -> test name for failed test reporting
  const testNames = new Map<number, string>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("{")) continue;

    try {
      const event = JSON.parse(trimmed) as {
        type?: string;
        test?: { id?: number; name?: string };
        testID?: number;
        result?: string;
        success?: boolean;
      };

      if (event.type === "testStart" && event.test) {
        if (event.test.id !== undefined && event.test.name) {
          testNames.set(event.test.id, event.test.name);
        }
      }

      if (event.type === "testDone") {
        if (event.result === "success") {
          passCount++;
        } else {
          failCount++;
          const name = event.testID !== undefined
            ? testNames.get(event.testID) ?? `test #${event.testID}`
            : "unknown test";
          failedTestNames.push(name);
        }
      }

      if (event.type === "done") {
        doneEvent = { success: event.success === true };
      }
    } catch {
      // Skip non-JSON lines (Gradle output contamination)
    }
  }

  return { doneEvent, passCount, failCount, failedTestNames };
}
