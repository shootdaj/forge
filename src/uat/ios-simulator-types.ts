/**
 * iOS Simulator Lifecycle Types and Error Classes
 *
 * Type definitions and error classes for the iOS Simulator lifecycle
 * manager. Mirrors the pattern from emulator-types.ts for Android.
 *
 * Requirements: IOS-01
 */

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Base error class for all iOS Simulator related errors.
 */
export class SimulatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulatorError";
  }
}

/**
 * Thrown when the iOS Simulator fails to boot within the timeout period.
 *
 * Requirement: IOS-01
 */
export class SimulatorBootTimeoutError extends SimulatorError {
  constructor(
    public readonly udid: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `iOS Simulator ${udid} failed to boot within ${timeoutMs}ms. ` +
        `Check that the device exists in Xcode.`,
    );
    this.name = "SimulatorBootTimeoutError";
  }
}

/**
 * Thrown when no matching iOS Simulator device is found.
 *
 * Requirement: IOS-01
 */
export class SimulatorNotFoundError extends SimulatorError {
  constructor(public readonly deviceName: string) {
    super(
      `No iOS Simulator found matching '${deviceName}'. ` +
        `Run: xcrun simctl list devices available`,
    );
    this.name = "SimulatorNotFoundError";
  }
}

/**
 * Thrown when Xcode command-line tools are not installed.
 *
 * Requirement: IOS-01
 */
export class XcodeNotAvailableError extends SimulatorError {
  constructor() {
    super(
      "Xcode command-line tools not found. Install Xcode from the " +
        "App Store and run: sudo xcode-select --install",
    );
    this.name = "XcodeNotAvailableError";
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Represents an iOS Simulator device from xcrun simctl output.
 *
 * Requirement: IOS-01
 */
export interface SimulatorDevice {
  /** Unique device identifier (UUID) */
  udid: string;
  /** Human-readable device name (e.g., "iPhone 15 Pro") */
  name: string;
  /** Device state: "Shutdown", "Booted", "Creating", etc. */
  state: string;
  /** Runtime identifier (e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-5") */
  runtime: string;
  /** Whether the device is available for use */
  isAvailable: boolean;
}

/**
 * Handle to a booted iOS Simulator instance.
 * Returned by bootSimulator() and passed to all subsequent operations.
 *
 * Requirement: IOS-01
 */
export interface SimulatorHandle {
  /** Unique device identifier (UUID) */
  udid: string;
  /** Human-readable device name */
  name: string;
  /** Runtime identifier */
  runtime: string;
  /** ISO timestamp when the simulator was booted */
  startedAt: string;
}

/**
 * Options for booting an iOS Simulator.
 *
 * Requirement: IOS-01
 */
export interface SimulatorBootOptions {
  /** Preferred device name (e.g., "iPhone 15 Pro"). Empty = auto-detect. */
  deviceName?: string;
  /** Boot readiness timeout in ms (default: 120000) */
  timeoutMs?: number;
  /** Polling interval for boot check in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Injectable exec function for testing — runs shell commands */
  execFn?: (cmd: string) => string;
}

/**
 * Options for waiting for simulator boot readiness.
 *
 * Requirement: IOS-01
 */
export interface SimulatorWaitOptions {
  /** Boot readiness timeout in ms (default: 120000) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Injectable exec function for testing */
  execFn?: (cmd: string) => string;
}
