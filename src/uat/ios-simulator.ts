/**
 * iOS Simulator Lifecycle Manager
 *
 * Self-contained module for booting, ready-waiting, and shutting down
 * iOS Simulators. All functions accept injectable dependencies for
 * comprehensive unit testing without real xcrun/simctl binaries.
 *
 * Mirrors the Android emulator lifecycle pattern from emulator.ts.
 *
 * Requirements: IOS-01
 */

import { execSync } from "node:child_process";
import type {
  SimulatorDevice,
  SimulatorHandle,
  SimulatorBootOptions,
  SimulatorWaitOptions,
} from "./ios-simulator-types.js";
import {
  SimulatorBootTimeoutError,
  SimulatorNotFoundError,
  XcodeNotAvailableError,
} from "./ios-simulator-types.js";

// ---------------------------------------------------------------------------
// Default injectable functions
// ---------------------------------------------------------------------------

const defaultExecFn = (cmd: string): string =>
  execSync(cmd, { encoding: "utf-8" });

// ---------------------------------------------------------------------------
// Xcode pre-flight check
// ---------------------------------------------------------------------------

/**
 * Verify Xcode command-line tools are available.
 *
 * Runs `xcrun simctl list devices -j` to check that xcrun and simctl
 * are installed and functional. Throws XcodeNotAvailableError if not.
 *
 * Requirement: IOS-01
 *
 * @param execFn - Injectable exec function for testing
 * @throws XcodeNotAvailableError if Xcode tools are not installed
 */
export function assertXcodeAvailable(
  execFn: (cmd: string) => string = defaultExecFn,
): void {
  try {
    execFn("xcrun simctl list devices -j");
  } catch {
    throw new XcodeNotAvailableError();
  }
}

// ---------------------------------------------------------------------------
// Simulator device listing
// ---------------------------------------------------------------------------

/**
 * Raw JSON structure from `xcrun simctl list devices -j`.
 */
interface SimctlDevicesOutput {
  devices: Record<
    string,
    Array<{
      udid: string;
      name: string;
      state: string;
      isAvailable?: boolean;
    }>
  >;
}

/**
 * List all available iOS Simulator devices.
 *
 * Parses `xcrun simctl list devices available -j` JSON output and
 * flattens into a flat array of SimulatorDevice objects.
 *
 * Requirement: IOS-01
 *
 * @param execFn - Injectable exec function for testing
 * @returns Array of available simulator devices
 */
export function listAvailableSimulators(
  execFn: (cmd: string) => string = defaultExecFn,
): SimulatorDevice[] {
  try {
    const output = execFn("xcrun simctl list devices available -j");
    const parsed: SimctlDevicesOutput = JSON.parse(output);
    const devices: SimulatorDevice[] = [];

    for (const [runtime, runtimeDevices] of Object.entries(parsed.devices)) {
      for (const device of runtimeDevices) {
        devices.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          runtime,
          isAvailable: device.isAvailable !== false,
        });
      }
    }

    return devices;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Simulator device selection
// ---------------------------------------------------------------------------

/**
 * Find the best simulator device to use.
 *
 * Selection logic:
 * 1. If preferred name is given, find exact match (case-insensitive)
 * 2. Otherwise, filter to iPhone devices only
 * 3. Sort by runtime descending (newest iOS first)
 * 4. Return first match
 *
 * Requirement: IOS-01
 *
 * @param devices - Available simulator devices
 * @param preferred - Optional preferred device name
 * @returns Best matching SimulatorDevice
 * @throws SimulatorNotFoundError if no matching device found
 */
export function findBestSimulator(
  devices: SimulatorDevice[],
  preferred?: string,
): SimulatorDevice {
  if (preferred && preferred.trim().length > 0) {
    const match = devices.find(
      (d) => d.name.toLowerCase() === preferred.toLowerCase(),
    );
    if (match) return match;
    throw new SimulatorNotFoundError(preferred);
  }

  // Filter to iPhone devices only (exclude iPad, Apple Watch, Apple TV)
  const iPhones = devices.filter((d) =>
    d.name.toLowerCase().startsWith("iphone"),
  );

  if (iPhones.length === 0) {
    throw new SimulatorNotFoundError("iPhone");
  }

  // Sort by runtime descending (newest iOS first)
  iPhones.sort((a, b) => b.runtime.localeCompare(a.runtime));

  return iPhones[0];
}

// ---------------------------------------------------------------------------
// Simulator boot
// ---------------------------------------------------------------------------

/**
 * Boot an iOS Simulator device.
 *
 * Steps:
 * 1. Assert Xcode is available (pre-flight check)
 * 2. List available simulators
 * 3. Find best matching device
 * 4. Run `xcrun simctl boot <udid>`
 * 5. Return SimulatorHandle
 *
 * Requirement: IOS-01
 *
 * @param options - Boot configuration including optional device name
 * @returns SimulatorHandle with device identifiers
 * @throws XcodeNotAvailableError if Xcode is not installed
 * @throws SimulatorNotFoundError if no matching device found
 */
export function bootSimulator(options: SimulatorBootOptions): SimulatorHandle {
  const execFn = options.execFn ?? defaultExecFn;

  // Pre-flight check
  assertXcodeAvailable(execFn);

  // Find device
  const devices = listAvailableSimulators(execFn);
  const device = findBestSimulator(devices, options.deviceName);

  // Boot the simulator
  try {
    execFn(`xcrun simctl boot ${device.udid}`);
  } catch (err: unknown) {
    // "Unable to boot device in current state: Booted" is fine
    const message =
      err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("booted")) {
      throw err;
    }
  }

  return {
    udid: device.udid,
    name: device.name,
    runtime: device.runtime,
    startedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Boot readiness polling
// ---------------------------------------------------------------------------

/**
 * Wait for the iOS Simulator to finish booting.
 *
 * Polls `xcrun simctl list devices -j` every pollIntervalMs until the
 * device state changes to "Booted". Throws SimulatorBootTimeoutError
 * after timeoutMs.
 *
 * Requirement: IOS-01
 *
 * @param handle - SimulatorHandle from bootSimulator()
 * @param options - Timeout and polling configuration
 * @throws SimulatorBootTimeoutError if boot doesn't complete within timeout
 */
export async function waitForSimulatorReady(
  handle: SimulatorHandle,
  options?: SimulatorWaitOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const execFn = options?.execFn ?? defaultExecFn;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const output = execFn("xcrun simctl list devices -j");
      const parsed: SimctlDevicesOutput = JSON.parse(output);

      // Search all runtimes for our device by UDID
      for (const runtimeDevices of Object.values(parsed.devices)) {
        for (const device of runtimeDevices) {
          if (device.udid === handle.udid && device.state === "Booted") {
            return; // Boot complete
          }
        }
      }
    } catch {
      // Command failed — simulator not ready yet, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new SimulatorBootTimeoutError(handle.udid, timeoutMs);
}

// ---------------------------------------------------------------------------
// Simulator shutdown
// ---------------------------------------------------------------------------

/**
 * Shut down a running iOS Simulator. Idempotent — safe to call on
 * already-shutdown devices.
 *
 * Never throws — shutdown errors are silently caught.
 *
 * Requirement: IOS-01
 *
 * @param handle - SimulatorHandle to shut down
 * @param execFn - Injectable exec function
 */
export async function shutdownSimulator(
  handle: SimulatorHandle,
  execFn: (cmd: string) => string = defaultExecFn,
): Promise<void> {
  try {
    execFn(`xcrun simctl shutdown ${handle.udid}`);
  } catch {
    // Shutdown is idempotent — already-shutdown device is fine
  }
}

// ---------------------------------------------------------------------------
// Cleanup handler registration
// ---------------------------------------------------------------------------

/**
 * Register process exit handlers to shut down the simulator on
 * crash/SIGINT/SIGTERM.
 *
 * Returns a deregister function to remove the handlers (for test isolation).
 *
 * Requirement: IOS-01
 *
 * @param handle - SimulatorHandle to protect
 * @returns Function to deregister the cleanup handlers
 */
export function registerSimulatorCleanup(handle: SimulatorHandle): () => void {
  const cleanup = () => {
    try {
      execSync(`xcrun simctl shutdown ${handle.udid}`, {
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch {
      // Best-effort cleanup
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return () => {
    process.removeListener("exit", cleanup);
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
  };
}

// ---------------------------------------------------------------------------
// High-level lifecycle wrapper
// ---------------------------------------------------------------------------

/**
 * High-level iOS Simulator lifecycle wrapper with guaranteed cleanup.
 *
 * Flow: boot -> wait for ready -> callback -> shutdown (always)
 *
 * This is the primary interface for UAT runner integration.
 *
 * Requirement: IOS-01
 *
 * @param options - Simulator boot configuration
 * @param callback - Function to execute with the booted simulator
 * @returns The callback's return value
 * @throws Whatever the callback throws (after cleanup)
 */
export async function withSimulator<T>(
  options: SimulatorBootOptions,
  callback: (handle: SimulatorHandle) => Promise<T>,
): Promise<T> {
  const handle = bootSimulator(options);
  const deregister = registerSimulatorCleanup(handle);

  try {
    await waitForSimulatorReady(handle, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      execFn: options.execFn,
    });
    return await callback(handle);
  } finally {
    deregister();
    await shutdownSimulator(handle, options.execFn);
  }
}

// ---------------------------------------------------------------------------
// State persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persist simulator UDID and name to forge-state.json for crash recovery.
 *
 * Requirement: IOS-01
 *
 * @param handle - SimulatorHandle with udid, name, startedAt
 * @param stateManager - StateManager instance
 */
export async function persistSimulatorState(
  handle: SimulatorHandle,
  stateManager: {
    update: (
      fn: (state: Record<string, unknown>) => Record<string, unknown>,
    ) => Promise<void>;
  },
): Promise<void> {
  await stateManager.update((state) => ({
    ...state,
    simulator: {
      udid: handle.udid,
      name: handle.name,
      startedAt: handle.startedAt,
    },
  }));
}

/**
 * Clear simulator state from forge-state.json after shutdown.
 *
 * Requirement: IOS-01
 *
 * @param stateManager - StateManager instance
 */
export async function clearSimulatorState(
  stateManager: {
    update: (
      fn: (state: Record<string, unknown>) => Record<string, unknown>,
    ) => Promise<void>;
  },
): Promise<void> {
  await stateManager.update((state) => ({
    ...state,
    simulator: {
      udid: "",
      name: "",
    },
  }));
}
