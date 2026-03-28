/**
 * Emulator Lifecycle Integration Tests
 *
 * Tests component interactions with real StateManager and temp dirs,
 * but mocked execFn/spawnFn for adb/emulator.
 *
 * Requirements: EMU-01 through EMU-06
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  persistEmulatorState,
  clearEmulatorState,
  killOrphanEmulators,
  withEmulator,
  registerCleanupHandler,
  waitForBoot,
} from "../../src/uat/emulator.js";
import { KvmUnavailableError, EmulatorBootTimeoutError } from "../../src/uat/emulator-types.js";
import { StateManager, createInitialState } from "../../src/state/index.js";

// Mock KVM to always pass unless we override
vi.mock("../../src/uat/kvm-check.js", () => ({
  assertKvmAvailable: vi.fn(),
}));

function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-emu-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("Emulator Lifecycle Integration", () => {
  let tempDir: string;
  let stateManager: StateManager;

  beforeEach(() => {
    tempDir = createTempDir();
    stateManager = new StateManager(tempDir);
    const state = createInitialState(tempDir);
    stateManager.save(state);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe("TestEmulatorIntegration_StatePersistence_RoundTrip", () => {
    it("persists and loads emulator state correctly", async () => {
      const handle = {
        pid: 4567,
        serial: "emulator-5554",
        avdName: "Pixel_6_API_33",
        startedAt: "2026-03-28T10:00:00.000Z",
      };

      await persistEmulatorState(handle, stateManager);
      const loaded = stateManager.load();

      expect(loaded.emulator.pid).toBe(4567);
      expect(loaded.emulator.serial).toBe("emulator-5554");
      expect(loaded.emulator.avdName).toBe("Pixel_6_API_33");
      expect(loaded.emulator.startedAt).toBe("2026-03-28T10:00:00.000Z");

      // Verify raw JSON uses snake_case
      const raw = JSON.parse(
        fs.readFileSync(path.join(tempDir, "forge-state.json"), "utf-8"),
      );
      expect(raw.emulator.avd_name).toBe("Pixel_6_API_33");
      expect(raw.emulator.started_at).toBe("2026-03-28T10:00:00.000Z");
    });
  });

  describe("TestEmulatorIntegration_OrphanCleanup_WithStateManager", () => {
    it("clears state after killing orphan", async () => {
      // Set up stale emulator state
      const state = stateManager.load();
      state.emulator = {
        pid: 12345,
        serial: "emulator-5554",
        avdName: "test_avd",
        startedAt: "2026-03-28T09:00:00.000Z",
      };
      stateManager.save(state);

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("emu kill")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        const killed = await killOrphanEmulators(stateManager, execFn);
        expect(killed).toContain("emulator-5554");

        // Verify state is cleared
        const loaded = stateManager.load();
        expect(loaded.emulator.pid).toBe(0);
        expect(loaded.emulator.serial).toBe("");
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestEmulatorIntegration_KvmCheckGatesStart", () => {
    it("KVM check runs and throws before any spawn attempt", async () => {
      const { assertKvmAvailable } = await import("../../src/uat/kvm-check.js");
      (assertKvmAvailable as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => {
          throw new KvmUnavailableError("KVM not available for test");
        },
      );

      const { startEmulator } = await import("../../src/uat/emulator.js");

      let spawnCalled = false;
      const spawnFn = () => {
        spawnCalled = true;
        return new EventEmitter() as unknown as import("node:child_process").ChildProcess;
      };

      expect(() =>
        startEmulator({
          avdName: "test",
          spawnFn,
          execFn: () => "",
        }),
      ).toThrow(KvmUnavailableError);

      expect(spawnCalled).toBe(false);
    });
  });

  describe("TestEmulatorIntegration_WithEmulator_FullLifecycle", () => {
    it("start -> boot -> callback -> teardown -> complete", async () => {
      const events: string[] = [];
      let devicesCallCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          devicesCallCount++;
          if (devicesCallCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) {
          events.push("boot_poll");
          return "1\n";
        }
        if (cmd.includes("emu kill")) {
          events.push("emu_kill");
          return "";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        const result = await withEmulator(
          {
            avdName: "test_avd",
            execFn,
            spawnFn: createMockSpawnFn(),
            timeoutMs: 5000,
            pollIntervalMs: 10,
          },
          async (handle) => {
            events.push("callback");
            expect(handle.serial).toBe("emulator-5554");
            return "done";
          },
        );

        expect(result).toBe("done");
        expect(events).toContain("boot_poll");
        expect(events).toContain("callback");
        expect(events).toContain("emu_kill");

        // Verify order: boot_poll before callback, callback before emu_kill
        const bootIdx = events.indexOf("boot_poll");
        const callbackIdx = events.indexOf("callback");
        const killIdx = events.indexOf("emu_kill");
        expect(bootIdx).toBeLessThan(callbackIdx);
        expect(callbackIdx).toBeLessThan(killIdx);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestEmulatorIntegration_CleanupHandler_RegisterAndDeregister", () => {
    it("handlers are registered and properly removed", () => {
      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      const exitBefore = process.listenerCount("exit");
      const sigintBefore = process.listenerCount("SIGINT");
      const sigtermBefore = process.listenerCount("SIGTERM");

      const deregister = registerCleanupHandler(handle);

      expect(process.listenerCount("exit")).toBe(exitBefore + 1);
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

      deregister();

      expect(process.listenerCount("exit")).toBe(exitBefore);
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    });
  });

  describe("TestEmulatorIntegration_BootTimeout_TriggersCleanup", () => {
    it("emulator is killed even when boot times out", async () => {
      let emuKillCalled = false;

      const handle = {
        pid: 9999,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      const execFn = (cmd: string): string => {
        if (cmd.includes("sys.boot_completed")) return "\n"; // Never boots
        if (cmd.includes("emu kill")) {
          emuKillCalled = true;
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        await expect(
          waitForBoot(handle, { timeoutMs: 50, pollIntervalMs: 10, execFn }),
        ).rejects.toThrow(EmulatorBootTimeoutError);

        // After timeout, caller should clean up
        const { stopEmulator } = await import("../../src/uat/emulator.js");
        await stopEmulator(handle, execFn);
        expect(emuKillCalled).toBe(true);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestEmulatorIntegration_OrphanCleanup_NoState_KillsAll", () => {
    it("kills all running emulators when no state manager provided", async () => {
      const killed: string[] = [];

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          return "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n\n";
        }
        if (cmd.includes("emu kill")) {
          const match = cmd.match(/adb -s (emulator-\d+)/);
          if (match) killed.push(match[1]);
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const result = await killOrphanEmulators(undefined, execFn);
      expect(result).toEqual(expect.arrayContaining(["emulator-5554", "emulator-5556"]));
    });
  });
});
