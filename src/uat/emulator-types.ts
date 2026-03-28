/**
 * Emulator Lifecycle Types and Error Classes
 *
 * Type definitions and error classes for the Android emulator lifecycle
 * manager. All types are self-contained — no circular dependencies.
 *
 * Requirements: EMU-01, EMU-02, EMU-03, EMU-04, EMU-05, EMU-06
 */

import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all emulator-related errors.
 */
export class EmulatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmulatorError";
  }
}

/**
 * Thrown when the emulator fails to boot within the timeout period.
 *
 * Requirement: EMU-02
 */
export class EmulatorBootTimeoutError extends EmulatorError {
  constructor(
    public readonly serial: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Emulator ${serial} failed to boot within ${timeoutMs}ms. ` +
        `Check that the AVD is valid and has sufficient resources.`,
    );
    this.name = "EmulatorBootTimeoutError";
  }
}

/**
 * Thrown when KVM is not available on the host platform.
 * Contains an actionable message with installation instructions.
 *
 * Requirement: EMU-06
 */
export class KvmUnavailableError extends EmulatorError {
  constructor(public readonly actionMessage: string) {
    super(`KVM is not available. ${actionMessage}`);
    this.name = "KvmUnavailableError";
  }
}

/**
 * Thrown when the emulator process exits unexpectedly during startup.
 *
 * Requirement: EMU-01
 */
export class EmulatorStartError extends EmulatorError {
  constructor(
    public readonly avdName: string,
    public readonly exitCode: number,
  ) {
    super(
      `Emulator for AVD '${avdName}' exited unexpectedly with code ${exitCode}. ` +
        `Verify the AVD exists: emulator -list-avds`,
    );
    this.name = "EmulatorStartError";
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Handle to a running emulator instance.
 * Returned by startEmulator() and passed to all subsequent operations.
 *
 * Requirement: EMU-05
 */
export interface EmulatorHandle {
  /** OS process ID of the emulator */
  pid: number;
  /** ADB serial (e.g., "emulator-5554") */
  serial: string;
  /** AVD name used to start the emulator */
  avdName: string;
  /** ISO timestamp when the emulator was started */
  startedAt: string;
  /** Reference to the child process (undefined after teardown) */
  process?: ChildProcess;
}

/**
 * Options for starting an emulator.
 *
 * Requirement: EMU-01
 */
export interface EmulatorStartOptions {
  /** AVD name to boot (e.g., "Pixel_6_API_33") */
  avdName: string;
  /** Boot readiness timeout in ms (default: 180000) */
  timeoutMs?: number;
  /** Polling interval for boot check in ms (default: 3000) */
  pollIntervalMs?: number;
  /** Injectable exec function for testing — runs shell commands */
  execFn?: (cmd: string) => string;
  /** Injectable spawn function for testing — spawns processes */
  spawnFn?: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ) => ChildProcess;
}

/**
 * Options for waiting for emulator boot readiness.
 *
 * Requirement: EMU-02
 */
export interface BootWaitOptions {
  /** Boot readiness timeout in ms (default: 180000) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 3000) */
  pollIntervalMs?: number;
  /** Injectable exec function for testing */
  execFn?: (cmd: string) => string;
}

/**
 * Result of a KVM availability check.
 *
 * Requirement: EMU-06
 */
export interface KvmCheckResult {
  /** Whether KVM (or HVF on macOS) is available */
  available: boolean;
  /** Actionable message when not available (install instructions) */
  message?: string;
}
