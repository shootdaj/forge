/**
 * Flutter Run Daemon Lifecycle Manager
 *
 * Self-contained module for starting, monitoring, and tearing down the
 * `flutter run` daemon process. All functions accept injectable dependencies
 * for comprehensive unit testing without real Flutter SDK.
 *
 * Requirements: MAE-03, MAE-04
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type {
  FlutterRunHandle,
  FlutterRunOptions,
  FlutterRunWaitOptions,
} from "./flutter-run-types.js";
import {
  FlutterRunReadyTimeoutError,
  FlutterRunStartError,
} from "./flutter-run-types.js";

// ---------------------------------------------------------------------------
// Default injectable functions
// ---------------------------------------------------------------------------

const defaultSpawnFn = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
): ChildProcess => spawn(command, args, options);

// ---------------------------------------------------------------------------
// Ready signal constant
// ---------------------------------------------------------------------------

/**
 * The stdout signal that indicates flutter run is ready for interaction.
 * Case-insensitive matching is used.
 */
const READY_SIGNAL = "flutter run key commands";

// ---------------------------------------------------------------------------
// Flutter run start
// ---------------------------------------------------------------------------

/**
 * Start flutter run as a daemon process targeting a specific device.
 *
 * Spawns `flutter run -d <serial>` with `detached: true` so the process
 * outlives the current event loop tick. Captures PID immediately for
 * cleanup even if the ready signal never arrives.
 *
 * Requirement: MAE-03
 *
 * @param options - Flutter run configuration
 * @returns FlutterRunHandle with pid and process reference
 */
export function startFlutterRun(options: FlutterRunOptions): FlutterRunHandle {
  const emulatorSpawn = options.spawnFn ?? defaultSpawnFn;

  const args = ["run", "-d", options.serial];

  const spawnOptions: Record<string, unknown> = {
    detached: true,
    stdio: "pipe",
  };

  if (options.projectDir) {
    spawnOptions.cwd = options.projectDir;
  }

  const child = emulatorSpawn("flutter", args, spawnOptions);

  // Capture PID immediately — enables cleanup even if ready signal never arrives
  const pid = child.pid ?? 0;

  // Try to unref so flutter run doesn't prevent Node from exiting
  try {
    child.unref();
  } catch {
    // unref may not be available in test mocks
  }

  return {
    pid,
    startedAt: new Date().toISOString(),
    process: child,
  };
}

// ---------------------------------------------------------------------------
// Ready signal detection
// ---------------------------------------------------------------------------

/**
 * Wait for flutter run to emit the ready signal in stdout.
 *
 * Scans stdout for "Flutter run key commands" (case-insensitive).
 * Resolves when the signal is found. Throws if timeout or process exits.
 *
 * Requirement: MAE-03
 *
 * @param handle - FlutterRunHandle from startFlutterRun()
 * @param options - Timeout configuration
 * @throws FlutterRunReadyTimeoutError if signal not seen within timeout
 * @throws FlutterRunStartError if process exits before signal
 */
export async function waitForFlutterRunReady(
  handle: FlutterRunHandle,
  options?: FlutterRunWaitOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 120_000;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = "";

    const cleanup = () => {
      settled = true;
      if (handle.process?.stdout) {
        handle.process.stdout.removeAllListeners("data");
      }
      if (handle.process) {
        handle.process.removeAllListeners("exit");
        handle.process.removeAllListeners("error");
      }
    };

    // Timeout handler
    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new FlutterRunReadyTimeoutError(timeoutMs));
    }, timeoutMs);

    // Process exit handler
    const onExit = (code: number | null) => {
      if (settled) return;
      cleanup();
      clearTimeout(timer);
      reject(new FlutterRunStartError(code ?? 1));
    };

    const onError = () => {
      if (settled) return;
      cleanup();
      clearTimeout(timer);
      reject(new FlutterRunStartError(1));
    };

    // Stdout data handler — scan for ready signal
    const onData = (chunk: Buffer | string) => {
      if (settled) return;

      stdoutBuffer += chunk.toString();

      if (stdoutBuffer.toLowerCase().includes(READY_SIGNAL)) {
        cleanup();
        clearTimeout(timer);
        resolve();
      }
    };

    if (handle.process?.stdout) {
      handle.process.stdout.on("data", onData);
    }
    if (handle.process) {
      handle.process.on("exit", onExit);
      handle.process.on("error", onError);
    }
  });
}

// ---------------------------------------------------------------------------
// Flutter run teardown
// ---------------------------------------------------------------------------

/**
 * Stop a running flutter run process. Tries SIGTERM first, then SIGKILL.
 *
 * Never throws — teardown errors are silent.
 *
 * Requirement: MAE-04
 *
 * @param handle - FlutterRunHandle to stop
 */
export async function stopFlutterRun(
  handle: FlutterRunHandle,
): Promise<void> {
  // Layer 1: SIGTERM
  try {
    process.kill(handle.pid, "SIGTERM");
  } catch {
    // Process may already be gone
    return;
  }

  // Wait up to 5 seconds for process to exit
  const graceMs = 5_000;
  const graceStart = Date.now();

  while (Date.now() - graceStart < graceMs) {
    try {
      process.kill(handle.pid, 0); // Check if alive
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
    // Process may already be gone
  }
}

// ---------------------------------------------------------------------------
// Cleanup handler registration
// ---------------------------------------------------------------------------

/**
 * Register process exit handlers to kill flutter run on crash/SIGINT/SIGTERM.
 *
 * Returns a deregister function to remove the handlers (for test isolation).
 *
 * Requirement: MAE-04
 *
 * @param handle - FlutterRunHandle to protect
 * @returns Function to deregister the cleanup handlers
 */
export function registerFlutterRunCleanup(
  handle: FlutterRunHandle,
): () => void {
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

// ---------------------------------------------------------------------------
// High-level lifecycle wrapper
// ---------------------------------------------------------------------------

/**
 * High-level flutter run lifecycle wrapper with guaranteed cleanup.
 *
 * Flow: start -> wait for ready -> callback -> teardown (always)
 *
 * Requirement: MAE-03, MAE-04
 *
 * @param options - Flutter run start configuration
 * @param callback - Function to execute with the ready flutter run
 * @returns The callback's return value
 * @throws Whatever the callback throws (after cleanup)
 */
export async function withFlutterRun<T>(
  options: FlutterRunOptions,
  callback: (handle: FlutterRunHandle) => Promise<T>,
): Promise<T> {
  const handle = startFlutterRun(options);
  const deregister = registerFlutterRunCleanup(handle);

  try {
    await waitForFlutterRunReady(handle, {
      timeoutMs: options.readyTimeoutMs,
    });
    return await callback(handle);
  } finally {
    deregister();
    await stopFlutterRun(handle);
  }
}
