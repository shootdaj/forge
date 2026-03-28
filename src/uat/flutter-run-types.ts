/**
 * Flutter Run Daemon Types and Error Classes
 *
 * Type definitions and error classes for the Flutter run daemon lifecycle.
 * Follows the same pattern as emulator-types.ts.
 *
 * Requirements: MAE-03, MAE-04
 */

import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all flutter run related errors.
 */
export class FlutterRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlutterRunError";
  }
}

/**
 * Thrown when flutter run does not produce the ready signal within timeout.
 *
 * Requirement: MAE-03
 */
export class FlutterRunReadyTimeoutError extends FlutterRunError {
  constructor(public readonly timeoutMs: number) {
    super(
      `Flutter run did not become ready within ${timeoutMs}ms. ` +
        `Check flutter run output for build errors.`,
    );
    this.name = "FlutterRunReadyTimeoutError";
  }
}

/**
 * Thrown when the flutter run process exits unexpectedly before becoming ready.
 *
 * Requirement: MAE-03
 */
export class FlutterRunStartError extends FlutterRunError {
  constructor(public readonly exitCode: number) {
    super(`Flutter run exited unexpectedly with code ${exitCode}.`);
    this.name = "FlutterRunStartError";
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Handle to a running flutter run process.
 *
 * Requirement: MAE-04
 */
export interface FlutterRunHandle {
  /** OS process ID of the flutter run process */
  pid: number;
  /** ISO timestamp when flutter run was started */
  startedAt: string;
  /** Reference to the child process (undefined after teardown) */
  process?: ChildProcess;
}

/**
 * Options for starting flutter run.
 *
 * Requirement: MAE-03
 */
export interface FlutterRunOptions {
  /** ADB serial of the target device (e.g., "emulator-5554") */
  serial: string;
  /** Project directory containing pubspec.yaml */
  projectDir?: string;
  /** Ready signal timeout in ms (default: 120000) */
  readyTimeoutMs?: number;
  /** Injectable spawn function for testing */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => ChildProcess;
}

/**
 * Options for waiting for flutter run to be ready.
 *
 * Requirement: MAE-03
 */
export interface FlutterRunWaitOptions {
  /** Ready signal timeout in ms (default: 120000) */
  timeoutMs?: number;
}
