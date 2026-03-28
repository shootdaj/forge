/**
 * Unit Tests: Flutter Run Daemon Lifecycle
 *
 * Tests for startFlutterRun, waitForFlutterRunReady, stopFlutterRun,
 * registerFlutterRunCleanup, and withFlutterRun.
 *
 * All tests use mock spawnFn — no real Flutter processes spawned.
 *
 * Requirements: MAE-03, MAE-04
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  startFlutterRun,
  waitForFlutterRunReady,
  stopFlutterRun,
  registerFlutterRunCleanup,
  withFlutterRun,
} from "./flutter-run.js";
import {
  FlutterRunReadyTimeoutError,
  FlutterRunStartError,
} from "./flutter-run-types.js";
import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Mock child process factory
// ---------------------------------------------------------------------------

function createMockProcess(pid = 12345): {
  process: ChildProcess;
  stdout: EventEmitter;
  emitExit: (code: number) => void;
  emitError: (err: Error) => void;
  emitStdout: (data: string) => void;
} {
  const stdout = new EventEmitter();
  const proc = new EventEmitter() as unknown as ChildProcess;

  (proc as unknown as Record<string, unknown>).pid = pid;
  (proc as unknown as Record<string, unknown>).stdout = stdout;
  (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stdin = null;
  proc.unref = vi.fn();
  proc.kill = vi.fn();

  return {
    process: proc,
    stdout,
    emitExit: (code: number) => proc.emit("exit", code),
    emitError: (err: Error) => proc.emit("error", err),
    emitStdout: (data: string) => stdout.emit("data", Buffer.from(data)),
  };
}

function createMockSpawnFn(mockProc: { process: ChildProcess }) {
  return vi.fn().mockReturnValue(mockProc.process);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("flutter-run", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // startFlutterRun
  // =========================================================================

  describe("startFlutterRun", () => {
    it("TestFlutterRun_StartSpawnsWithCorrectArgs", () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);

      startFlutterRun({ serial: "emulator-5554", spawnFn });

      expect(spawnFn).toHaveBeenCalledWith(
        "flutter",
        ["run", "-d", "emulator-5554"],
        expect.objectContaining({ detached: true, stdio: "pipe" }),
      );
    });

    it("TestFlutterRun_StartCapturesPid", () => {
      const mock = createMockProcess(99999);
      const spawnFn = createMockSpawnFn(mock);

      const handle = startFlutterRun({ serial: "emulator-5554", spawnFn });

      expect(handle.pid).toBe(99999);
      expect(handle.startedAt).toBeDefined();
      expect(handle.process).toBe(mock.process);
    });

    it("TestFlutterRun_StartWithProjectDir", () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);

      startFlutterRun({
        serial: "emulator-5554",
        projectDir: "/tmp/myapp",
        spawnFn,
      });

      expect(spawnFn).toHaveBeenCalledWith(
        "flutter",
        ["run", "-d", "emulator-5554"],
        expect.objectContaining({ cwd: "/tmp/myapp" }),
      );
    });

    it("TestFlutterRun_StartCallsUnref", () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);

      startFlutterRun({ serial: "emulator-5554", spawnFn });

      expect(mock.process.unref).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // waitForFlutterRunReady
  // =========================================================================

  describe("waitForFlutterRunReady", () => {
    it("TestFlutterRun_ReadySignalDetected", async () => {
      const mock = createMockProcess();
      const handle = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        process: mock.process,
      };

      const readyPromise = waitForFlutterRunReady(handle);

      // Emit ready signal after a tick
      setTimeout(() => {
        mock.emitStdout("Performing hot restart...\nFlutter run key commands.\nPress r to reload.\n");
      }, 10);

      await readyPromise; // Should resolve without throwing
    });

    it("TestFlutterRun_ReadyCaseInsensitive", async () => {
      const mock = createMockProcess();
      const handle = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        process: mock.process,
      };

      const readyPromise = waitForFlutterRunReady(handle);

      setTimeout(() => {
        mock.emitStdout("flutter run key commands");
      }, 10);

      await readyPromise; // Should resolve (case-insensitive match)
    });

    it("TestFlutterRun_ReadyTimeoutThrows", async () => {
      const mock = createMockProcess();
      const handle = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        process: mock.process,
      };

      // Very short timeout — signal will never arrive
      await expect(
        waitForFlutterRunReady(handle, { timeoutMs: 50 }),
      ).rejects.toThrow(FlutterRunReadyTimeoutError);
    });

    it("TestFlutterRun_ProcessExitBeforeReady", async () => {
      const mock = createMockProcess();
      const handle = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        process: mock.process,
      };

      const readyPromise = waitForFlutterRunReady(handle);

      // Process exits before ready signal
      setTimeout(() => {
        mock.emitExit(1);
      }, 10);

      await expect(readyPromise).rejects.toThrow(FlutterRunStartError);
    });

    it("TestFlutterRun_ReadySignalInChunkedOutput", async () => {
      const mock = createMockProcess();
      const handle = {
        pid: 12345,
        startedAt: new Date().toISOString(),
        process: mock.process,
      };

      const readyPromise = waitForFlutterRunReady(handle);

      // Signal arrives across multiple chunks
      setTimeout(() => {
        mock.emitStdout("Building...\nFlutter run ");
      }, 5);
      setTimeout(() => {
        mock.emitStdout("key commands.\n");
      }, 15);

      await readyPromise; // Should detect combined signal
    });
  });

  // =========================================================================
  // stopFlutterRun
  // =========================================================================

  describe("stopFlutterRun", () => {
    it("TestFlutterRun_StopSendsSigterm", async () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("No such process"); // Process already gone after SIGTERM
      });

      const handle = { pid: 99999, startedAt: new Date().toISOString() };
      await stopFlutterRun(handle);

      expect(killSpy).toHaveBeenCalledWith(99999, "SIGTERM");
      killSpy.mockRestore();
    });

    it("TestFlutterRun_StopNeverThrows", async () => {
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const handle = { pid: 99999, startedAt: new Date().toISOString() };

      // Should not throw
      await expect(stopFlutterRun(handle)).resolves.toBeUndefined();

      vi.restoreAllMocks();
    });
  });

  // =========================================================================
  // registerFlutterRunCleanup
  // =========================================================================

  describe("registerFlutterRunCleanup", () => {
    it("TestFlutterRun_CleanupRegistersHandlers", () => {
      const handle = { pid: 99999, startedAt: new Date().toISOString() };
      const onSpy = vi.spyOn(process, "on");

      const deregister = registerFlutterRunCleanup(handle);

      expect(onSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

      // Cleanup
      deregister();
      onSpy.mockRestore();
    });

    it("TestFlutterRun_DeregisterRemovesHandlers", () => {
      const handle = { pid: 99999, startedAt: new Date().toISOString() };
      const removeSpy = vi.spyOn(process, "removeListener");

      const deregister = registerFlutterRunCleanup(handle);
      deregister();

      expect(removeSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

      removeSpy.mockRestore();
    });
  });

  // =========================================================================
  // withFlutterRun
  // =========================================================================

  describe("withFlutterRun", () => {
    it("TestFlutterRun_WithFlutterRunCallsCallback", async () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);
      const callback = vi.fn().mockResolvedValue("result");

      // Emit ready signal immediately
      setTimeout(() => {
        mock.emitStdout("Flutter run key commands.\n");
      }, 5);

      // Mock process.kill for cleanup
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("No such process");
      });

      const result = await withFlutterRun(
        { serial: "emulator-5554", spawnFn },
        callback,
      );

      expect(callback).toHaveBeenCalledOnce();
      expect(result).toBe("result");

      killSpy.mockRestore();
    });

    it("TestFlutterRun_WithFlutterRunCleansUpOnFailure", async () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);
      const callbackError = new Error("Callback failed");
      const callback = vi.fn().mockRejectedValue(callbackError);

      setTimeout(() => {
        mock.emitStdout("Flutter run key commands.\n");
      }, 5);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("No such process");
      });

      await expect(
        withFlutterRun({ serial: "emulator-5554", spawnFn }, callback),
      ).rejects.toThrow("Callback failed");

      // Verify cleanup was called (kill was attempted)
      expect(killSpy).toHaveBeenCalled();

      killSpy.mockRestore();
    });

    it("TestFlutterRun_WithFlutterRunPropagatesCallbackError", async () => {
      const mock = createMockProcess();
      const spawnFn = createMockSpawnFn(mock);

      setTimeout(() => {
        mock.emitStdout("Flutter run key commands.\n");
      }, 5);

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("No such process");
      });

      await expect(
        withFlutterRun({ serial: "emulator-5554", spawnFn }, async () => {
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");

      killSpy.mockRestore();
    });
  });
});
