/**
 * Emulator Lifecycle Scenario Tests
 *
 * End-to-end scenarios testing complete user workflows.
 * All scenarios use mocked execFn/spawnFn — no real Android SDK required.
 *
 * Requirements: EMU-01 through EMU-06
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  withEmulator,
  killOrphanEmulators,
  persistEmulatorState,
  clearEmulatorState,
} from "../../src/uat/emulator.js";
import {
  EmulatorBootTimeoutError,
  KvmUnavailableError,
} from "../../src/uat/emulator-types.js";
import { checkKvmAvailability } from "../../src/uat/kvm-check.js";
import { StateManager, createInitialState } from "../../src/state/index.js";

// Mock KVM for most tests
vi.mock("../../src/uat/kvm-check.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/uat/kvm-check.js")>();
  return {
    ...original,
    assertKvmAvailable: vi.fn(),
  };
});

function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-emu-scen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockSpawnFn(pid: number = 1234) {
  return (
    _command: string,
    _args: string[],
    _options: Record<string, unknown>,
  ) => {
    const child = new EventEmitter() as unknown as import("node:child_process").ChildProcess;
    Object.defineProperty(child, "pid", { value: pid, writable: false });
    (child as Record<string, unknown>).stdin = null;
    (child as Record<string, unknown>).stdout = new EventEmitter();
    (child as Record<string, unknown>).stderr = new EventEmitter();
    (child as Record<string, unknown>).unref = vi.fn();
    return child;
  };
}

describe("Emulator Lifecycle Scenarios", () => {
  let tempDir: string;
  let stateManager: StateManager;
  const origKill = process.kill;

  beforeEach(() => {
    tempDir = createTempDir();
    stateManager = new StateManager(tempDir);
    const state = createInitialState(tempDir);
    stateManager.save(state);

    // Mock process.kill for all scenarios
    process.kill = vi.fn((_pid: number, signal?: string | number) => {
      if (signal === 0) throw new Error("ESRCH"); // Process not found
      if (signal === "SIGKILL") return true;
      throw new Error("ESRCH");
    }) as unknown as typeof process.kill;
  });

  afterEach(() => {
    process.kill = origKill;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("TestScenario_EmulatorLifecycle_HappyPath", () => {
    it("full lifecycle: KVM -> orphan cleanup -> start -> boot -> callback -> teardown", async () => {
      const events: string[] = [];
      let devicesCallCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          devicesCallCount++;
          // Initial orphan check: no emulators
          if (devicesCallCount <= 2)
            return "List of devices attached\n\n";
          // After spawn: emulator appeared
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) {
          events.push("boot_check");
          return "1\n";
        }
        if (cmd.includes("emu kill")) {
          events.push("teardown");
          return "";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      // Step 1: Orphan cleanup (should find nothing)
      const orphans = await killOrphanEmulators(stateManager, execFn);
      expect(orphans).toEqual([]);
      events.push("orphan_cleanup_done");

      // Step 2: Full lifecycle via withEmulator
      const result = await withEmulator(
        {
          avdName: "Pixel_6_API_33",
          execFn,
          spawnFn: createMockSpawnFn(4567),
          timeoutMs: 5000,
          pollIntervalMs: 10,
        },
        async (handle) => {
          events.push("callback_start");
          expect(handle.pid).toBe(4567);
          expect(handle.serial).toBe("emulator-5554");
          expect(handle.avdName).toBe("Pixel_6_API_33");

          // Persist state during callback
          await persistEmulatorState(handle, stateManager);
          const loaded = stateManager.load();
          expect(loaded.emulator.pid).toBe(4567);
          events.push("callback_end");

          return "test_passed";
        },
      );

      expect(result).toBe("test_passed");
      expect(events).toContain("orphan_cleanup_done");
      expect(events).toContain("boot_check");
      expect(events).toContain("callback_start");
      expect(events).toContain("callback_end");
      expect(events).toContain("teardown");
    });
  });

  describe("TestScenario_EmulatorLifecycle_BootTimeout", () => {
    it("boot timeout -> cleanup -> state cleared", async () => {
      let devicesCallCount = 0;
      let emuKilled = false;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          devicesCallCount++;
          if (devicesCallCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) {
          return "\n"; // Never boots
        }
        if (cmd.includes("emu kill")) {
          emuKilled = true;
          return "";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      await expect(
        withEmulator(
          {
            avdName: "slow_avd",
            execFn,
            spawnFn: createMockSpawnFn(),
            timeoutMs: 80,
            pollIntervalMs: 10,
          },
          async () => {
            throw new Error("Should not reach callback");
          },
        ),
      ).rejects.toThrow(EmulatorBootTimeoutError);

      // Emulator should still be killed (finally block)
      expect(emuKilled).toBe(true);
    });
  });

  describe("TestScenario_EmulatorLifecycle_CrashRecovery", () => {
    it("detects orphan from crashed run -> kills -> starts fresh", async () => {
      // Simulate a previous crash: stale emulator state
      const state = stateManager.load();
      state.emulator = {
        pid: 99999,
        serial: "emulator-5554",
        avdName: "old_avd",
        startedAt: "2026-03-28T09:00:00.000Z",
      };
      stateManager.save(state);

      let orphanKilled = false;
      let devicesCallCount = 0;
      let freshCallbackRan = false;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          devicesCallCount++;
          // First two calls: orphan is running
          if (devicesCallCount <= 2) {
            return "List of devices attached\nemulator-5554\tdevice\n\n";
          }
          // After orphan kill + fresh spawn
          if (devicesCallCount <= 4) {
            return "List of devices attached\n\n";
          }
          return "List of devices attached\nemulator-5556\tdevice\n\n";
        }
        if (cmd.includes("adb -s emulator-5554 emu kill")) {
          orphanKilled = true;
          return "";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) return "";
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      // Step 1: Kill orphans
      const killed = await killOrphanEmulators(stateManager, execFn);
      expect(orphanKilled).toBe(true);
      expect(killed).toContain("emulator-5554");

      // Verify state is cleared
      const clearedState = stateManager.load();
      expect(clearedState.emulator.pid).toBe(0);

      // Step 2: Start fresh emulator
      const result = await withEmulator(
        {
          avdName: "fresh_avd",
          execFn,
          spawnFn: createMockSpawnFn(7777),
          timeoutMs: 5000,
          pollIntervalMs: 10,
        },
        async (handle) => {
          freshCallbackRan = true;
          expect(handle.serial).toBe("emulator-5556");
          return "fresh_success";
        },
      );

      expect(freshCallbackRan).toBe(true);
      expect(result).toBe("fresh_success");
    });
  });

  describe("TestScenario_EmulatorLifecycle_KvmUnavailable", () => {
    it("KVM unavailable -> actionable error before any emulator operation", async () => {
      const { assertKvmAvailable } = await import("../../src/uat/kvm-check.js");
      (assertKvmAvailable as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          throw new KvmUnavailableError(
            "KVM not available. Install: sudo apt install qemu-kvm",
          );
        },
      );

      let spawnCalled = false;
      const spawnFn = () => {
        spawnCalled = true;
        return new EventEmitter() as unknown as import("node:child_process").ChildProcess;
      };

      const { startEmulator } = await import("../../src/uat/emulator.js");

      expect(() =>
        startEmulator({
          avdName: "test_avd",
          spawnFn,
          execFn: () => "",
        }),
      ).toThrow(KvmUnavailableError);

      // No emulator process should have been spawned
      expect(spawnCalled).toBe(false);

      // Verify the real checkKvmAvailability returns actionable message for Linux
      const result = checkKvmAvailability("linux", {
        existsSync: () => false,
      });
      expect(result.available).toBe(false);
      expect(result.message).toContain("sudo apt install qemu-kvm");
    });
  });

  describe("TestScenario_EmulatorLifecycle_CallbackError", () => {
    it("callback error -> emulator still cleaned up -> error re-thrown", async () => {
      let devicesCallCount = 0;
      let emuKilled = false;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          devicesCallCount++;
          if (devicesCallCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) {
          emuKilled = true;
          return "";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const callbackError = new Error("UAT test failure in Maestro flow");

      await expect(
        withEmulator(
          {
            avdName: "test_avd",
            execFn,
            spawnFn: createMockSpawnFn(),
            timeoutMs: 5000,
            pollIntervalMs: 10,
          },
          async () => {
            throw callbackError;
          },
        ),
      ).rejects.toThrow("UAT test failure in Maestro flow");

      // Emulator must still be killed despite callback error
      expect(emuKilled).toBe(true);
    });
  });
});
