/**
 * iOS Simulator Lifecycle Unit Tests
 *
 * All tests use injectable execFn — no real xcrun/simctl binaries.
 *
 * Requirements: IOS-01
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  assertXcodeAvailable,
  listAvailableSimulators,
  findBestSimulator,
  bootSimulator,
  waitForSimulatorReady,
  shutdownSimulator,
  registerSimulatorCleanup,
  withSimulator,
  persistSimulatorState,
  clearSimulatorState,
} from "./ios-simulator.js";
import {
  SimulatorBootTimeoutError,
  SimulatorNotFoundError,
  XcodeNotAvailableError,
} from "./ios-simulator-types.js";
import type { SimulatorDevice, SimulatorHandle } from "./ios-simulator-types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SAMPLE_SIMCTL_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      {
        udid: "AAAA-1111",
        name: "iPhone 15 Pro",
        state: "Shutdown",
        isAvailable: true,
      },
      {
        udid: "BBBB-2222",
        name: "iPhone 14",
        state: "Shutdown",
        isAvailable: true,
      },
      {
        udid: "CCCC-3333",
        name: "iPad Air (5th generation)",
        state: "Shutdown",
        isAvailable: true,
      },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
      {
        udid: "DDDD-4444",
        name: "iPhone 13",
        state: "Shutdown",
        isAvailable: true,
      },
    ],
  },
});

const BOOTED_SIMCTL_JSON = (udid: string) =>
  JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
        {
          udid,
          name: "iPhone 15 Pro",
          state: "Booted",
          isAvailable: true,
        },
      ],
    },
  });

const SHUTDOWN_SIMCTL_JSON = (udid: string) =>
  JSON.stringify({
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
        {
          udid,
          name: "iPhone 15 Pro",
          state: "Shutdown",
          isAvailable: true,
        },
      ],
    },
  });

function createMockExecFn(responses: Record<string, string>) {
  return (cmd: string): string => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  };
}

// ---------------------------------------------------------------------------
// assertXcodeAvailable
// ---------------------------------------------------------------------------

describe("assertXcodeAvailable", () => {
  describe("TestXcodeCheck_Available", () => {
    it("does not throw when xcrun simctl works", () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices -j": '{"devices":{}}',
      });
      expect(() => assertXcodeAvailable(execFn)).not.toThrow();
    });
  });

  describe("TestXcodeCheck_NotAvailable", () => {
    it("throws XcodeNotAvailableError when xcrun fails", () => {
      const execFn = () => {
        throw new Error("command not found: xcrun");
      };
      expect(() => assertXcodeAvailable(execFn)).toThrow(
        XcodeNotAvailableError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// listAvailableSimulators
// ---------------------------------------------------------------------------

describe("listAvailableSimulators", () => {
  describe("TestListSimulators_ParsesJsonOutput", () => {
    it("parses multi-runtime JSON into flat array", () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices available -j": SAMPLE_SIMCTL_JSON,
      });
      const result = listAvailableSimulators(execFn);
      expect(result).toHaveLength(4);
      expect(result[0].name).toBe("iPhone 15 Pro");
      expect(result[0].udid).toBe("AAAA-1111");
      expect(result[0].runtime).toBe(
        "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
      );
      expect(result[3].name).toBe("iPhone 13");
      expect(result[3].runtime).toBe(
        "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
      );
    });
  });

  describe("TestListSimulators_EmptyResult", () => {
    it("returns empty array when no devices exist", () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices available -j": '{"devices":{}}',
      });
      const result = listAvailableSimulators(execFn);
      expect(result).toEqual([]);
    });
  });

  describe("TestListSimulators_CommandFails", () => {
    it("returns empty array when xcrun fails", () => {
      const execFn = () => {
        throw new Error("xcrun failed");
      };
      const result = listAvailableSimulators(execFn);
      expect(result).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// findBestSimulator
// ---------------------------------------------------------------------------

describe("findBestSimulator", () => {
  const devices: SimulatorDevice[] = [
    {
      udid: "AAAA-1111",
      name: "iPhone 15 Pro",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
      isAvailable: true,
    },
    {
      udid: "BBBB-2222",
      name: "iPhone 14",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
      isAvailable: true,
    },
    {
      udid: "CCCC-3333",
      name: "iPad Air (5th generation)",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
      isAvailable: true,
    },
    {
      udid: "DDDD-4444",
      name: "iPhone 13",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
      isAvailable: true,
    },
    {
      udid: "EEEE-5555",
      name: "Apple Watch Series 9 - 45mm",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.watchOS-10-5",
      isAvailable: true,
    },
  ];

  describe("TestFindSimulator_PreferredDeviceMatch", () => {
    it("returns exact name match (case-insensitive)", () => {
      const result = findBestSimulator(devices, "iphone 14");
      expect(result.udid).toBe("BBBB-2222");
      expect(result.name).toBe("iPhone 14");
    });
  });

  describe("TestFindSimulator_PreferredNotFound", () => {
    it("throws SimulatorNotFoundError for unknown device", () => {
      expect(() => findBestSimulator(devices, "Nonexistent")).toThrow(
        SimulatorNotFoundError,
      );
    });
  });

  describe("TestFindSimulator_AutoSelectNewestIPhone", () => {
    it("selects newest iPhone by runtime when no preference", () => {
      const result = findBestSimulator(devices);
      // iOS-17-5 is newer than iOS-16-4, so should pick from that runtime
      expect(result.runtime).toContain("iOS-17");
      expect(result.name).toMatch(/^iPhone/);
    });
  });

  describe("TestFindSimulator_FiltersiPadAndWatch", () => {
    it("excludes iPad and Apple Watch from auto-select", () => {
      const result = findBestSimulator(devices);
      expect(result.name).not.toContain("iPad");
      expect(result.name).not.toContain("Apple Watch");
    });
  });

  describe("TestFindSimulator_NoDevicesAvailable", () => {
    it("throws SimulatorNotFoundError for empty array", () => {
      expect(() => findBestSimulator([])).toThrow(SimulatorNotFoundError);
    });
  });

  describe("TestFindSimulator_OnlyNonIPhoneDevices", () => {
    it("throws when only iPad and Watch available", () => {
      const nonIPhones = devices.filter((d) => !d.name.startsWith("iPhone"));
      expect(() => findBestSimulator(nonIPhones)).toThrow(
        SimulatorNotFoundError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// bootSimulator
// ---------------------------------------------------------------------------

describe("bootSimulator", () => {
  describe("TestBootSimulator_Success", () => {
    it("boots simulator and returns handle", () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices -j": '{"devices":{}}',
        "xcrun simctl list devices available -j": SAMPLE_SIMCTL_JSON,
        "xcrun simctl boot": "",
      });
      const handle = bootSimulator({ execFn });
      expect(handle.udid).toBe("AAAA-1111");
      expect(handle.name).toBe("iPhone 15 Pro");
      expect(handle.runtime).toContain("iOS-17-5");
      expect(handle.startedAt).toBeTruthy();
    });
  });

  describe("TestBootSimulator_XcodeNotAvailable", () => {
    it("throws XcodeNotAvailableError when xcrun fails", () => {
      const execFn = () => {
        throw new Error("command not found");
      };
      expect(() => bootSimulator({ execFn })).toThrow(XcodeNotAvailableError);
    });
  });

  describe("TestBootSimulator_AlreadyBooted", () => {
    it("handles already-booted device gracefully", () => {
      let bootCalled = false;
      const execFn = (cmd: string): string => {
        if (cmd.includes("xcrun simctl list devices -j"))
          return '{"devices":{}}';
        if (cmd.includes("xcrun simctl list devices available -j"))
          return SAMPLE_SIMCTL_JSON;
        if (cmd.includes("xcrun simctl boot")) {
          bootCalled = true;
          const err = new Error(
            "Unable to boot device in current state: Booted",
          );
          throw err;
        }
        throw new Error(`Unexpected: ${cmd}`);
      };
      const handle = bootSimulator({ execFn });
      expect(bootCalled).toBe(true);
      expect(handle.udid).toBe("AAAA-1111");
    });
  });

  describe("TestBootSimulator_WithPreferredDevice", () => {
    it("boots specific device when deviceName is set", () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices -j": '{"devices":{}}',
        "xcrun simctl list devices available -j": SAMPLE_SIMCTL_JSON,
        "xcrun simctl boot": "",
      });
      const handle = bootSimulator({
        execFn,
        deviceName: "iPhone 14",
      });
      expect(handle.udid).toBe("BBBB-2222");
      expect(handle.name).toBe("iPhone 14");
    });
  });
});

// ---------------------------------------------------------------------------
// waitForSimulatorReady
// ---------------------------------------------------------------------------

describe("waitForSimulatorReady", () => {
  const handle: SimulatorHandle = {
    udid: "AAAA-1111",
    name: "iPhone 15 Pro",
    runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
    startedAt: new Date().toISOString(),
  };

  describe("TestWaitForReady_ImmediatelyBooted", () => {
    it("resolves immediately when device is already booted", async () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices -j": BOOTED_SIMCTL_JSON("AAAA-1111"),
      });
      await expect(
        waitForSimulatorReady(handle, {
          execFn,
          timeoutMs: 5000,
          pollIntervalMs: 100,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("TestWaitForReady_BootsAfterPolling", () => {
    it("resolves after device transitions to Booted", async () => {
      let callCount = 0;
      const execFn = (cmd: string): string => {
        if (cmd.includes("xcrun simctl list devices -j")) {
          callCount++;
          if (callCount <= 2) {
            return SHUTDOWN_SIMCTL_JSON("AAAA-1111");
          }
          return BOOTED_SIMCTL_JSON("AAAA-1111");
        }
        throw new Error(`Unexpected: ${cmd}`);
      };
      await expect(
        waitForSimulatorReady(handle, {
          execFn,
          timeoutMs: 5000,
          pollIntervalMs: 50,
        }),
      ).resolves.toBeUndefined();
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("TestWaitForReady_Timeout", () => {
    it("throws SimulatorBootTimeoutError when boot never completes", async () => {
      const execFn = createMockExecFn({
        "xcrun simctl list devices -j": SHUTDOWN_SIMCTL_JSON("AAAA-1111"),
      });
      await expect(
        waitForSimulatorReady(handle, {
          execFn,
          timeoutMs: 200,
          pollIntervalMs: 50,
        }),
      ).rejects.toThrow(SimulatorBootTimeoutError);
    });
  });
});

// ---------------------------------------------------------------------------
// shutdownSimulator
// ---------------------------------------------------------------------------

describe("shutdownSimulator", () => {
  const handle: SimulatorHandle = {
    udid: "AAAA-1111",
    name: "iPhone 15 Pro",
    runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
    startedAt: new Date().toISOString(),
  };

  describe("TestShutdown_Success", () => {
    it("shuts down simulator without error", async () => {
      const execFn = createMockExecFn({
        "xcrun simctl shutdown": "",
      });
      await expect(shutdownSimulator(handle, execFn)).resolves.toBeUndefined();
    });
  });

  describe("TestShutdown_NeverThrows", () => {
    it("does not throw when shutdown fails", async () => {
      const execFn = () => {
        throw new Error("shutdown failed");
      };
      await expect(shutdownSimulator(handle, execFn)).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// withSimulator
// ---------------------------------------------------------------------------

describe("withSimulator", () => {
  describe("TestWithSimulator_FullLifecycle", () => {
    it("boots, runs callback, and shuts down", async () => {
      let shutdownCalled = false;

      const execFn = (cmd: string): string => {
        // assertXcodeAvailable and waitForSimulatorReady both call
        // "xcrun simctl list devices -j" (without "available")
        if (
          cmd === "xcrun simctl list devices -j" ||
          cmd.match(/^xcrun simctl list devices -j$/)
        ) {
          return BOOTED_SIMCTL_JSON("AAAA-1111");
        }
        // listAvailableSimulators calls with "available" flag
        if (cmd.includes("xcrun simctl list devices available -j")) {
          return SAMPLE_SIMCTL_JSON;
        }
        if (cmd.includes("xcrun simctl boot")) return "";
        if (cmd.includes("xcrun simctl shutdown")) {
          shutdownCalled = true;
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      const result = await withSimulator(
        { execFn, timeoutMs: 5000, pollIntervalMs: 50 },
        async (handle) => {
          expect(handle.udid).toBe("AAAA-1111");
          return "callback-result";
        },
      );

      expect(result).toBe("callback-result");
      expect(shutdownCalled).toBe(true);
    });
  });

  describe("TestWithSimulator_CleanupOnCallbackError", () => {
    it("shuts down simulator even when callback throws", async () => {
      let shutdownCalled = false;

      const execFn = (cmd: string): string => {
        if (
          cmd === "xcrun simctl list devices -j" ||
          cmd.match(/^xcrun simctl list devices -j$/)
        ) {
          return BOOTED_SIMCTL_JSON("AAAA-1111");
        }
        if (cmd.includes("xcrun simctl list devices available -j")) {
          return SAMPLE_SIMCTL_JSON;
        }
        if (cmd.includes("xcrun simctl boot")) return "";
        if (cmd.includes("xcrun simctl shutdown")) {
          shutdownCalled = true;
          return "";
        }
        throw new Error(`Unexpected: ${cmd}`);
      };

      await expect(
        withSimulator(
          { execFn, timeoutMs: 5000, pollIntervalMs: 50 },
          async () => {
            throw new Error("Callback failed");
          },
        ),
      ).rejects.toThrow("Callback failed");

      expect(shutdownCalled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// registerSimulatorCleanup
// ---------------------------------------------------------------------------

describe("registerSimulatorCleanup", () => {
  describe("TestCleanupRegistration_ReturnsDeregister", () => {
    it("returns a callable deregister function", () => {
      const handle: SimulatorHandle = {
        udid: "AAAA-1111",
        name: "iPhone 15 Pro",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
        startedAt: new Date().toISOString(),
      };
      const deregister = registerSimulatorCleanup(handle);
      expect(typeof deregister).toBe("function");
      // Clean up — deregister to avoid side effects in other tests
      deregister();
    });
  });
});

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

describe("persistSimulatorState", () => {
  describe("TestPersistState_WritesUdidAndName", () => {
    it("persists simulator handle to state", async () => {
      const handle: SimulatorHandle = {
        udid: "AAAA-1111",
        name: "iPhone 15 Pro",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
        startedAt: "2026-03-28T10:00:00Z",
      };
      let savedState: Record<string, unknown> = {};
      const stateManager = {
        update: vi.fn(async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => {
          savedState = fn({ existing: "data" });
        }),
      };
      await persistSimulatorState(handle, stateManager);
      expect(stateManager.update).toHaveBeenCalledOnce();
      expect(savedState).toEqual({
        existing: "data",
        simulator: {
          udid: "AAAA-1111",
          name: "iPhone 15 Pro",
          startedAt: "2026-03-28T10:00:00Z",
        },
      });
    });
  });
});

describe("clearSimulatorState", () => {
  describe("TestClearState_ResetsToDefaults", () => {
    it("clears simulator state to empty values", async () => {
      let savedState: Record<string, unknown> = {};
      const stateManager = {
        update: vi.fn(async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => {
          savedState = fn({
            simulator: { udid: "AAAA-1111", name: "iPhone 15 Pro" },
          });
        }),
      };
      await clearSimulatorState(stateManager);
      expect(stateManager.update).toHaveBeenCalledOnce();
      expect(savedState).toEqual({
        simulator: { udid: "", name: "" },
      });
    });
  });
});
