/**
 * Android Emulator Lifecycle Manager
 *
 * Self-contained module for starting, boot-waiting, and tearing down
 * Android emulators. All functions accept injectable dependencies for
 * comprehensive unit testing without real adb/emulator binaries.
 *
 * Requirements: EMU-01, EMU-02, EMU-03, EMU-04, EMU-05
 */

import { spawn, execSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type {
  EmulatorHandle,
  EmulatorStartOptions,
  BootWaitOptions,
} from "./emulator-types.js";
import {
  EmulatorStartError,
  EmulatorBootTimeoutError,
} from "./emulator-types.js";
import { assertKvmAvailable } from "./kvm-check.js";
import type { StateManager } from "../state/state-manager.js";

// ---------------------------------------------------------------------------
// Default injectable functions
// ---------------------------------------------------------------------------

const defaultExecFn = (cmd: string): string =>
  execSync(cmd, { encoding: "utf-8" });

const defaultSpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
): ChildProcess => spawn(command, args, options);

// ---------------------------------------------------------------------------
// Emulator serial discovery
// ---------------------------------------------------------------------------

/**
 * Parse `adb devices` output and return list of emulator serials.
 * Only includes devices with status "device" (not "offline" or "unauthorized").
 * Excludes physical device serials (non-emulator-NNNN patterns).
 *
 * @param execFn - Injectable exec function for testing
 * @returns Array of emulator serial strings (e.g., ["emulator-5554"])
 */
export function listEmulatorSerials(
  execFn: (cmd: string) => string = defaultExecFn,
): string[] {
  try {
    const output = execFn("adb devices");
    const lines = output.split("\n");
    const serials: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Format: "emulator-5554\tdevice"
      const match = trimmed.match(/^(emulator-\d+)\s+device$/);
      if (match) {
        serials.push(match[1]);
      }
    }

    return serials;
  } catch {
    // adb not available or failed — no emulators detectable
    return [];
  }
}

// ---------------------------------------------------------------------------
// Emulator start
// ---------------------------------------------------------------------------

/**
 * Start a headless Android emulator with CI-friendly flags.
 *
 * Spawns the emulator process with:
 *   -no-audio -no-window -gpu swiftshader_indirect -no-boot-anim -no-snapshot-save
 *
 * Captures the PID immediately after spawn (before boot) so cleanup
 * is possible even if boot fails.
 *
 * Requirement: EMU-01
 *
 * @param options - Emulator configuration including AVD name
 * @returns EmulatorHandle with pid, serial, and process reference
 * @throws KvmUnavailableError if KVM is not available
 * @throws EmulatorStartError if the emulator exits before serial appears
 */
export function startEmulator(options: EmulatorStartOptions): EmulatorHandle {
  const execFn = options.execFn ?? defaultExecFn;
  const emulatorSpawn = options.spawnFn ?? defaultSpawnFn;

  // KVM pre-flight check (EMU-06)
  assertKvmAvailable();

  // Snapshot serials BEFORE spawn for disambiguation
  const serialsBefore = listEmulatorSerials(execFn);

  // Spawn emulator with headless CI flags
  const args = [
    "-avd",
    options.avdName,
    "-no-audio",
    "-no-window",
    "-gpu",
    "swiftshader_indirect",
    "-no-boot-anim",
    "-no-snapshot-save",
  ];

  const child = emulatorSpawn("emulator", args, {
    detached: true,
    stdio: "pipe",
  });

  // Capture PID immediately — enables cleanup even if boot fails
  const pid = child.pid ?? 0;

  // Track early exit
  let earlyExit = false;
  let exitCode = 0;

  child.on("error", () => {
    earlyExit = true;
  });
  child.on("exit", (code) => {
    earlyExit = true;
    exitCode = code ?? 1;
  });

  // Try to unref so the emulator doesn't prevent Node from exiting
  try {
    child.unref();
  } catch {
    // unref may not be available in test mocks
  }

  // Discover the new serial — poll briefly for it to appear
  const serialTimeout = 30_000; // 30 seconds to discover serial
  const pollInterval = 1_000; // 1 second
  const startTime = Date.now();
  let serial = "";

  // Synchronous polling for serial discovery
  while (Date.now() - startTime < serialTimeout) {
    if (earlyExit) {
      throw new EmulatorStartError(options.avdName, exitCode);
    }

    const currentSerials = listEmulatorSerials(execFn);
    const newSerials = currentSerials.filter(
      (s) => !serialsBefore.includes(s),
    );

    if (newSerials.length > 0) {
      serial = newSerials[0];
      break;
    }

    // Synchronous sleep (acceptable for boot sequence — not in hot path)
    try {
      execFn(`sleep 1`);
    } catch {
      // sleep command may fail in test mocks — use a basic busy-wait fallback
      const busyEnd = Date.now() + pollInterval;
      while (Date.now() < busyEnd) {
        // busy wait
      }
    }
  }

  if (!serial) {
    // No serial found — emulator may have failed to start
    if (earlyExit) {
      throw new EmulatorStartError(options.avdName, exitCode);
    }
    throw new EmulatorStartError(options.avdName, -1);
  }

  return {
    pid,
    serial,
    avdName: options.avdName,
    startedAt: new Date().toISOString(),
    process: child,
  };
}

// ---------------------------------------------------------------------------
// Boot readiness polling
// ---------------------------------------------------------------------------

/**
 * Wait for the emulator to complete boot by polling sys.boot_completed.
 *
 * Polls `adb -s <serial> shell getprop sys.boot_completed` every pollIntervalMs
 * until it returns "1". Throws EmulatorBootTimeoutError after timeoutMs.
 *
 * Does NOT use `adb wait-for-device` — it fires during early boot before
 * the system is fully ready.
 *
 * Requirement: EMU-02
 *
 * @param handle - EmulatorHandle from startEmulator()
 * @param options - Timeout and polling configuration
 * @throws EmulatorBootTimeoutError if boot doesn't complete within timeout
 */
export async function waitForBoot(
  handle: EmulatorHandle,
  options?: BootWaitOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 3_000;
  const execFn = options?.execFn ?? defaultExecFn;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = execFn(
        `adb -s ${handle.serial} shell getprop sys.boot_completed`,
      );
      if (result.trim() === "1") {
        return; // Boot complete
      }
    } catch {
      // adb command failed — device not ready yet, continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new EmulatorBootTimeoutError(handle.serial, timeoutMs);
}

// ---------------------------------------------------------------------------
// Emulator teardown
// ---------------------------------------------------------------------------

/**
 * Stop a running emulator. Tries graceful shutdown first, then SIGKILL.
 *
 * Never throws — teardown errors are logged as warnings.
 *
 * Requirement: EMU-03
 *
 * @param handle - EmulatorHandle to stop
 * @param execFn - Injectable exec function
 */
export async function stopEmulator(
  handle: EmulatorHandle,
  execFn: (cmd: string) => string = defaultExecFn,
): Promise<void> {
  // Layer 1: graceful shutdown via adb
  try {
    execFn(`adb -s ${handle.serial} emu kill`);
  } catch {
    // Graceful kill failed — will try SIGKILL below
  }

  // Wait up to 5 seconds for process to exit
  const graceMs = 5_000;
  const graceStart = Date.now();

  while (Date.now() - graceStart < graceMs) {
    try {
      // process.kill(pid, 0) throws if process doesn't exist
      process.kill(handle.pid, 0);
    } catch {
      // Process is gone — success
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Layer 2: SIGKILL if still alive
  try {
    process.kill(handle.pid, "SIGKILL");
  } catch {
    // Process may already be gone — that's fine
  }
}

/**
 * Register process exit handlers to kill the emulator on crash/SIGINT/SIGTERM.
 *
 * Returns a deregister function to remove the handlers (for test isolation).
 *
 * Requirement: EMU-03
 *
 * @param handle - EmulatorHandle to protect
 * @returns Function to deregister the cleanup handlers
 */
export function registerCleanupHandler(handle: EmulatorHandle): () => void {
  const cleanup = () => {
    try {
      process.kill(handle.pid, "SIGKILL");
    } catch {
      // Process may already be gone
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

/**
 * High-level emulator lifecycle wrapper with guaranteed cleanup.
 *
 * Flow: start -> boot wait -> callback -> teardown (always)
 *
 * This is the primary interface for Phase 11 (Maestro UAT) integration.
 *
 * Requirement: EMU-03
 *
 * @param options - Emulator start configuration
 * @param callback - Function to execute with the booted emulator
 * @returns The callback's return value
 * @throws Whatever the callback throws (after cleanup)
 */
export async function withEmulator<T>(
  options: EmulatorStartOptions,
  callback: (handle: EmulatorHandle) => Promise<T>,
): Promise<T> {
  const handle = startEmulator(options);
  const deregister = registerCleanupHandler(handle);

  try {
    await waitForBoot(handle, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      execFn: options.execFn,
    });
    return await callback(handle);
  } finally {
    deregister();
    await stopEmulator(handle, options.execFn);
  }
}

// ---------------------------------------------------------------------------
// Orphan emulator management
// ---------------------------------------------------------------------------

/**
 * Detect and kill orphan emulators from previous crashed runs.
 *
 * Three-step approach:
 * 1. Check forge-state.json for stored PID/serial from a crashed run
 * 2. Kill tracked orphans via adb emu kill + SIGKILL
 * 3. Kill any remaining untracked emulators (belt-and-suspenders)
 *
 * Never throws — orphan cleanup failure is non-fatal.
 *
 * Requirement: EMU-04
 *
 * @param stateManager - Optional state manager for reading stored PID/serial
 * @param execFn - Injectable exec function
 * @returns Array of killed emulator serials
 */
export async function killOrphanEmulators(
  stateManager?: StateManager,
  execFn: (cmd: string) => string = defaultExecFn,
): Promise<string[]> {
  const killed: string[] = [];

  try {
    // Step 1: Get currently running emulators
    const runningSerials = listEmulatorSerials(execFn);
    if (runningSerials.length === 0) {
      return killed; // Fast path — nothing running
    }

    // Step 2: Check state for tracked orphan
    if (stateManager) {
      try {
        const state = stateManager.load();
        const storedSerial = state.emulator.serial;
        const storedPid = state.emulator.pid;

        if (storedSerial && runningSerials.includes(storedSerial)) {
          // Kill tracked orphan via adb
          try {
            execFn(`adb -s ${storedSerial} emu kill`);
            killed.push(storedSerial);
          } catch {
            // Graceful kill failed — try SIGKILL
          }
        }

        // Also try SIGKILL on stored PID
        if (storedPid > 0) {
          try {
            process.kill(storedPid, 0); // Check if alive
            process.kill(storedPid, "SIGKILL");
          } catch {
            // Process already gone — fine
          }
        }

        // Clear emulator state
        await clearEmulatorState(stateManager);
      } catch {
        // State load failed — continue with untracked cleanup
      }
    }

    // Step 3: Kill any remaining untracked emulators
    const stillRunning = listEmulatorSerials(execFn);
    for (const serial of stillRunning) {
      if (!killed.includes(serial)) {
        try {
          execFn(`adb -s ${serial} emu kill`);
          killed.push(serial);
        } catch {
          // Kill failed — continue with others
        }
      }
    }
  } catch {
    // Orphan cleanup is non-fatal — return whatever we managed to kill
  }

  return killed;
}

// ---------------------------------------------------------------------------
// State persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persist emulator PID and serial to forge-state.json for crash recovery.
 *
 * Requirement: EMU-05
 *
 * @param handle - EmulatorHandle with pid, serial, avdName, startedAt
 * @param stateManager - StateManager instance
 */
export async function persistEmulatorState(
  handle: EmulatorHandle,
  stateManager: StateManager,
): Promise<void> {
  await stateManager.update((state) => ({
    ...state,
    emulator: {
      pid: handle.pid,
      serial: handle.serial,
      avdName: handle.avdName,
      startedAt: handle.startedAt,
    },
  }));
}

/**
 * Clear emulator state from forge-state.json after teardown.
 *
 * Requirement: EMU-05
 *
 * @param stateManager - StateManager instance
 */
export async function clearEmulatorState(
  stateManager: StateManager,
): Promise<void> {
  await stateManager.update((state) => ({
    ...state,
    emulator: {
      pid: 0,
      serial: "",
      avdName: "",
    },
  }));
}
