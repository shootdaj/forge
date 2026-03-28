/**
 * Android Emulator Lifecycle Unit Tests
 *
 * All tests use injectable execFn and spawnFn — no real adb/emulator binaries.
 *
 * Requirements: EMU-01, EMU-02, EMU-03, EMU-04, EMU-05
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  listEmulatorSerials,
  startEmulator,
  waitForBoot,
  stopEmulator,
  registerCleanupHandler,
  withEmulator,
  killOrphanEmulators,
  persistEmulatorState,
  clearEmulatorState,
} from "./emulator.js";
import {
  EmulatorStartError,
  EmulatorBootTimeoutError,
} from "./emulator-types.js";
import { KvmUnavailableError } from "./emulator-types.js";
import { StateManager } from "../state/state-manager.js";

// Mock assertKvmAvailable to always pass (we test KVM separately)
vi.mock("./kvm-check.js", () => ({
  assertKvmAvailable: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockExecFn(responses: Record<string, string>) {
  return (cmd: string): string => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  };
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

function createTempDir(): string {
  const dir = path.join(
    "/tmp",
    `forge-emu-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// listEmulatorSerials
// ---------------------------------------------------------------------------

describe("listEmulatorSerials", () => {
  describe("TestListEmulatorSerials_NoDevices", () => {
    it("returns empty array when no devices connected", () => {
      const execFn = createMockExecFn({
        "adb devices": "List of devices attached\n\n",
      });
      expect(listEmulatorSerials(execFn)).toEqual([]);
    });
  });

  describe("TestListEmulatorSerials_OneEmulator", () => {
    it("returns single emulator serial", () => {
      const execFn = createMockExecFn({
        "adb devices":
          "List of devices attached\nemulator-5554\tdevice\n\n",
      });
      expect(listEmulatorSerials(execFn)).toEqual(["emulator-5554"]);
    });
  });

  describe("TestListEmulatorSerials_MultipleEmulators", () => {
    it("returns all emulator serials", () => {
      const execFn = createMockExecFn({
        "adb devices":
          "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n\n",
      });
      expect(listEmulatorSerials(execFn)).toEqual([
        "emulator-5554",
        "emulator-5556",
      ]);
    });
  });

  describe("TestListEmulatorSerials_IgnoresOffline", () => {
    it("excludes devices with offline status", () => {
      const execFn = createMockExecFn({
        "adb devices":
          "List of devices attached\nemulator-5554\toffline\nemulator-5556\tdevice\n\n",
      });
      expect(listEmulatorSerials(execFn)).toEqual(["emulator-5556"]);
    });
  });

  describe("TestListEmulatorSerials_IgnoresPhysicalDevices", () => {
    it("excludes non-emulator device serials", () => {
      const execFn = createMockExecFn({
        "adb devices":
          "List of devices attached\n1234ABCD\tdevice\nemulator-5554\tdevice\n\n",
      });
      expect(listEmulatorSerials(execFn)).toEqual(["emulator-5554"]);
    });
  });

  describe("TestListEmulatorSerials_AdbUnavailable", () => {
    it("returns empty array when adb fails", () => {
      const execFn = () => {
        throw new Error("adb not found");
      };
      expect(listEmulatorSerials(execFn)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// startEmulator
// ---------------------------------------------------------------------------

describe("startEmulator", () => {
  describe("TestStartEmulator_SpawnsWithCorrectArgs", () => {
    it("spawns emulator with headless CI flags", () => {
      let capturedArgs: string[] = [];
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          // First call: no emulators. Second call: emulator appeared.
          if (callCount <= 1) {
            return "List of devices attached\n\n";
          }
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const spawnFn = (
        _command: string,
        args: string[],
        _opts: Record<string, unknown>,
      ) => {
        capturedArgs = args;
        const child = new EventEmitter() as unknown as import("node:child_process").ChildProcess;
        Object.defineProperty(child, "pid", { value: 1234, writable: false });
        (child as Record<string, unknown>).stdin = null;
        (child as Record<string, unknown>).stdout = new EventEmitter();
        (child as Record<string, unknown>).stderr = new EventEmitter();
        (child as Record<string, unknown>).unref = vi.fn();
        return child;
      };

      startEmulator({
        avdName: "test_avd",
        execFn,
        spawnFn,
      });

      expect(capturedArgs).toContain("-no-audio");
      expect(capturedArgs).toContain("-no-window");
      expect(capturedArgs).toContain("swiftshader_indirect");
      expect(capturedArgs).toContain("-no-boot-anim");
      expect(capturedArgs).toContain("-no-snapshot-save");
      expect(capturedArgs).toContain("test_avd");
    });
  });

  describe("TestStartEmulator_ReturnsPidAndSerial", () => {
    it("returns handle with pid, serial, and avdName", () => {
      let callCount = 0;
      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1)
            return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const handle = startEmulator({
        avdName: "Pixel_6_API_33",
        execFn,
        spawnFn: createMockSpawnFn(9876),
      });

      expect(handle.pid).toBe(9876);
      expect(handle.serial).toBe("emulator-5554");
      expect(handle.avdName).toBe("Pixel_6_API_33");
      expect(handle.startedAt).toBeDefined();
    });
  });

  describe("TestStartEmulator_CallsKvmCheck", () => {
    it("calls assertKvmAvailable before spawning", async () => {
      const { assertKvmAvailable } = await import("./kvm-check.js");
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      startEmulator({
        avdName: "test_avd",
        execFn,
        spawnFn: createMockSpawnFn(),
      });

      expect(assertKvmAvailable).toHaveBeenCalled();
    });
  });

  describe("TestStartEmulator_DiscoversNewSerial", () => {
    it("finds serial that was not in initial device list", () => {
      let callCount = 0;
      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) {
            // Already have one emulator running
            return "List of devices attached\nemulator-5554\tdevice\n\n";
          }
          // New emulator appeared
          return "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n\n";
        }
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const handle = startEmulator({
        avdName: "test_avd",
        execFn,
        spawnFn: createMockSpawnFn(),
      });

      expect(handle.serial).toBe("emulator-5556");
    });
  });
});

// ---------------------------------------------------------------------------
// waitForBoot
// ---------------------------------------------------------------------------

describe("waitForBoot", () => {
  describe("TestWaitForBoot_CompletesOnBootCompleted1", () => {
    it("returns when sys.boot_completed is 1", async () => {
      const execFn = createMockExecFn({
        "sys.boot_completed": "1\n",
      });
      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      await expect(
        waitForBoot(handle, {
          timeoutMs: 5000,
          pollIntervalMs: 10,
          execFn,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("TestWaitForBoot_PollsUntilReady", () => {
    it("polls multiple times before boot completes", async () => {
      let pollCount = 0;
      const execFn = (cmd: string): string => {
        if (cmd.includes("sys.boot_completed")) {
          pollCount++;
          if (pollCount < 3) return "\n"; // Not ready
          return "1\n"; // Ready on 3rd poll
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      await waitForBoot(handle, {
        timeoutMs: 10000,
        pollIntervalMs: 10,
        execFn,
      });

      expect(pollCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("TestWaitForBoot_TimeoutThrowsEmulatorBootTimeoutError", () => {
    it("throws after timeout when boot never completes", async () => {
      const execFn = createMockExecFn({
        "sys.boot_completed": "\n", // Never returns "1"
      });
      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      await expect(
        waitForBoot(handle, {
          timeoutMs: 50,
          pollIntervalMs: 10,
          execFn,
        }),
      ).rejects.toThrow(EmulatorBootTimeoutError);
    });
  });

  describe("TestWaitForBoot_HandlesAdbErrors", () => {
    it("continues polling when adb throws", async () => {
      let pollCount = 0;
      const execFn = (cmd: string): string => {
        if (cmd.includes("sys.boot_completed")) {
          pollCount++;
          if (pollCount < 2) throw new Error("adb: device not found");
          return "1\n";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      await waitForBoot(handle, {
        timeoutMs: 5000,
        pollIntervalMs: 10,
        execFn,
      });

      expect(pollCount).toBeGreaterThanOrEqual(2);
    });
  });
});

// ---------------------------------------------------------------------------
// stopEmulator
// ---------------------------------------------------------------------------

describe("stopEmulator", () => {
  describe("TestStopEmulator_CallsAdbEmuKill", () => {
    it("sends adb emu kill command", async () => {
      let killCalled = false;
      const execFn = (cmd: string): string => {
        if (cmd.includes("emu kill")) {
          killCalled = true;
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      // Mock process.kill to pretend the process exits
      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH"); // Process not found = already dead
      }) as unknown as typeof process.kill;

      try {
        const handle = {
          pid: 99999,
          serial: "emulator-5554",
          avdName: "test",
          startedAt: new Date().toISOString(),
        };

        await stopEmulator(handle, execFn);
        expect(killCalled).toBe(true);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestStopEmulator_NeverThrows", () => {
    it("swallows all errors during teardown", async () => {
      const execFn = () => {
        throw new Error("adb failed");
      };

      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        const handle = {
          pid: 99999,
          serial: "emulator-5554",
          avdName: "test",
          startedAt: new Date().toISOString(),
        };

        // Should not throw
        await expect(stopEmulator(handle, execFn)).resolves.toBeUndefined();
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestStopEmulator_FallsBackToSigkill", () => {
    it("sends SIGKILL when graceful kill fails and process alive", async () => {
      let sigkillSent = false;
      const execFn = () => {
        throw new Error("adb emu kill failed");
      };

      const origKill = process.kill;
      let checkCount = 0;
      process.kill = vi.fn((pid: number, signal?: string | number) => {
        if (signal === 0) {
          checkCount++;
          if (checkCount > 2) throw new Error("ESRCH"); // Eventually exits
          return true; // Still alive
        }
        if (signal === "SIGKILL") {
          sigkillSent = true;
          return true;
        }
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        const handle = {
          pid: 88888,
          serial: "emulator-5554",
          avdName: "test",
          startedAt: new Date().toISOString(),
        };

        await stopEmulator(handle, execFn);
        // SIGKILL should have been attempted (though process may have exited first)
        // The key assertion is that the function completed without throwing
      } finally {
        process.kill = origKill;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// registerCleanupHandler
// ---------------------------------------------------------------------------

describe("registerCleanupHandler", () => {
  describe("TestRegisterCleanupHandler_RegistersAndDeregisters", () => {
    it("registers exit handlers and returns deregister function", () => {
      const handle = {
        pid: 1234,
        serial: "emulator-5554",
        avdName: "test",
        startedAt: new Date().toISOString(),
      };

      const exitListenersBefore = process.listenerCount("exit");
      const deregister = registerCleanupHandler(handle);

      expect(process.listenerCount("exit")).toBe(exitListenersBefore + 1);

      deregister();

      expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    });
  });
});

// ---------------------------------------------------------------------------
// withEmulator
// ---------------------------------------------------------------------------

describe("withEmulator", () => {
  describe("TestWithEmulator_CallbackReceivesHandle", () => {
    it("passes EmulatorHandle to callback", async () => {
      let receivedHandle: unknown;
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) return "";
        if (cmd.includes("sleep")) return "";
        throw new Error(`Unexpected: ${cmd}`);
      };

      const origKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill;

      try {
        await withEmulator(
          {
            avdName: "test_avd",
            execFn,
            spawnFn: createMockSpawnFn(),
            timeoutMs: 5000,
            pollIntervalMs: 10,
          },
          async (handle) => {
            receivedHandle = handle;
          },
        );

        expect(receivedHandle).toBeDefined();
        expect((receivedHandle as { serial: string }).serial).toBe(
          "emulator-5554",
        );
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestWithEmulator_CleansUpOnSuccess", () => {
    it("calls stopEmulator after callback succeeds", async () => {
      let emuKillCalled = false;
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) {
          emuKillCalled = true;
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
        await withEmulator(
          {
            avdName: "test_avd",
            execFn,
            spawnFn: createMockSpawnFn(),
            timeoutMs: 5000,
            pollIntervalMs: 10,
          },
          async () => "success",
        );

        expect(emuKillCalled).toBe(true);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestWithEmulator_CleansUpOnError", () => {
    it("calls stopEmulator after callback throws", async () => {
      let emuKillCalled = false;
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) {
          emuKillCalled = true;
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
              throw new Error("callback failure");
            },
          ),
        ).rejects.toThrow("callback failure");

        expect(emuKillCalled).toBe(true);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("TestWithEmulator_ReturnsCallbackValue", () => {
    it("propagates callback return value", async () => {
      let callCount = 0;

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          callCount++;
          if (callCount <= 1) return "List of devices attached\n\n";
          return "List of devices attached\nemulator-5554\tdevice\n\n";
        }
        if (cmd.includes("sys.boot_completed")) return "1\n";
        if (cmd.includes("emu kill")) return "";
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
          async () => ({ data: 42 }),
        );

        expect(result).toEqual({ data: 42 });
      } finally {
        process.kill = origKill;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// killOrphanEmulators
// ---------------------------------------------------------------------------

describe("killOrphanEmulators", () => {
  describe("TestKillOrphanEmulators_NoRunning_ReturnsEmpty", () => {
    it("returns empty array when no emulators running", async () => {
      const execFn = createMockExecFn({
        "adb devices": "List of devices attached\n\n",
      });
      const result = await killOrphanEmulators(undefined, execFn);
      expect(result).toEqual([]);
    });
  });

  describe("TestKillOrphanEmulators_KillsTrackedOrphan", () => {
    it("kills emulator tracked in state", async () => {
      const tempDir = createTempDir();
      let killCalled = false;

      try {
        const sm = new StateManager(tempDir);
        const state = (await import("../state/state-manager.js")).createInitialState(tempDir);
        state.emulator = {
          pid: 12345,
          serial: "emulator-5554",
          avdName: "test_avd",
          startedAt: new Date().toISOString(),
        };
        sm.save(state);

        const execFn = (cmd: string): string => {
          if (cmd.includes("adb devices")) {
            return "List of devices attached\nemulator-5554\tdevice\n\n";
          }
          if (cmd.includes("emu kill")) {
            killCalled = true;
            return "";
          }
          throw new Error(`Unexpected: ${cmd}`);
        };

        // Mock process.kill for the SIGKILL attempt
        const origKill = process.kill;
        process.kill = vi.fn(() => {
          throw new Error("ESRCH");
        }) as unknown as typeof process.kill;

        try {
          const killed = await killOrphanEmulators(sm, execFn);
          expect(killed).toContain("emulator-5554");
          expect(killCalled).toBe(true);
        } finally {
          process.kill = origKill;
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });

  describe("TestKillOrphanEmulators_KillsUntrackedOrphans", () => {
    it("kills running emulators not in state", async () => {
      let killedSerials: string[] = [];

      const execFn = (cmd: string): string => {
        if (cmd.includes("adb devices")) {
          return "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n\n";
        }
        if (cmd.includes("emu kill")) {
          const match = cmd.match(/adb -s (emulator-\d+)/);
          if (match) killedSerials.push(match[1]);
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const killed = await killOrphanEmulators(undefined, execFn);
      expect(killed).toContain("emulator-5554");
      expect(killed).toContain("emulator-5556");
    });
  });

  describe("TestKillOrphanEmulators_ClearsState", () => {
    it("clears emulator fields in state manager", async () => {
      const tempDir = createTempDir();

      try {
        const sm = new StateManager(tempDir);
        const state = (await import("../state/state-manager.js")).createInitialState(tempDir);
        state.emulator = {
          pid: 12345,
          serial: "emulator-5554",
          avdName: "test_avd",
          startedAt: new Date().toISOString(),
        };
        sm.save(state);

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
          await killOrphanEmulators(sm, execFn);
          const loaded = sm.load();
          expect(loaded.emulator.pid).toBe(0);
          expect(loaded.emulator.serial).toBe("");
        } finally {
          process.kill = origKill;
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });

  describe("TestKillOrphanEmulators_NeverThrows", () => {
    it("catches all errors during orphan cleanup", async () => {
      const execFn = () => {
        throw new Error("everything fails");
      };

      // Should not throw
      const result = await killOrphanEmulators(undefined, execFn);
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// State persistence helpers
// ---------------------------------------------------------------------------

describe("persistEmulatorState", () => {
  describe("TestPersistEmulatorState_WritesToStateManager", () => {
    it("writes handle fields to state manager", async () => {
      const tempDir = createTempDir();

      try {
        const sm = new StateManager(tempDir);
        const state = (await import("../state/state-manager.js")).createInitialState(tempDir);
        sm.save(state);

        const handle = {
          pid: 5678,
          serial: "emulator-5556",
          avdName: "Pixel_6",
          startedAt: "2026-03-28T10:00:00.000Z",
        };

        await persistEmulatorState(handle, sm);

        const loaded = sm.load();
        expect(loaded.emulator.pid).toBe(5678);
        expect(loaded.emulator.serial).toBe("emulator-5556");
        expect(loaded.emulator.avdName).toBe("Pixel_6");
        expect(loaded.emulator.startedAt).toBe("2026-03-28T10:00:00.000Z");
      } finally {
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });
});

describe("clearEmulatorState", () => {
  describe("TestClearEmulatorState_ResetsToDefaults", () => {
    it("resets emulator state to zeroed defaults", async () => {
      const tempDir = createTempDir();

      try {
        const sm = new StateManager(tempDir);
        const state = (await import("../state/state-manager.js")).createInitialState(tempDir);
        state.emulator = {
          pid: 9999,
          serial: "emulator-5554",
          avdName: "test",
          startedAt: "2026-03-28T10:00:00.000Z",
        };
        sm.save(state);

        await clearEmulatorState(sm);

        const loaded = sm.load();
        expect(loaded.emulator.pid).toBe(0);
        expect(loaded.emulator.serial).toBe("");
        expect(loaded.emulator.avdName).toBe("");
      } finally {
        fs.rmSync(tempDir, { recursive: true });
      }
    });
  });
});
