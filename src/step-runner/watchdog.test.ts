/**
 * Watchdog Unit Tests
 *
 * Tests for the session watchdog module: executeWithWatchdog() and runWithRetries().
 * All tests use fake timers for deterministic behavior.
 *
 * Requirements tested: Phase 15 — Session Watchdog
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeWithWatchdog,
  runWithRetries,
  type WatchdogConfig,
  type WatchdogCallbacks,
} from "./watchdog.js";

function makeConfig(overrides: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    inactivityTimeoutMs: 200,
    heartbeatIntervalMs: 50,
    maxRetries: 2,
    stepName: "test-step",
    ...overrides,
  };
}

function makeCallbacks(): WatchdogCallbacks & {
  heartbeats: Array<{ seconds: number; stepName: string }>;
  timeouts: Array<{ attempt: number; stepName: string }>;
  retries: Array<{ attempt: number; stepName: string }>;
} {
  const heartbeats: Array<{ seconds: number; stepName: string }> = [];
  const timeouts: Array<{ attempt: number; stepName: string }> = [];
  const retries: Array<{ attempt: number; stepName: string }> = [];

  return {
    heartbeats,
    timeouts,
    retries,
    onHeartbeat: (seconds, stepName) => {
      heartbeats.push({ seconds, stepName });
    },
    onTimeout: (attempt, stepName) => {
      timeouts.push({ attempt, stepName });
    },
    onRetry: (attempt, stepName) => {
      retries.push({ attempt, stepName });
    },
  };
}

describe("executeWithWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TestWatchdog_CompletesBeforeTimeout", async () => {
    const config = makeConfig();
    const callbacks = makeCallbacks();

    const resultPromise = executeWithWatchdog(
      async (_abortController) => "success",
      config,
      callbacks,
    );

    // executeFn resolves immediately (microtask)
    const result = await resultPromise;

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.result).toBe("success");
    }
  });

  it("TestWatchdog_TimeoutFiresAfterInactivity", async () => {
    const config = makeConfig({ inactivityTimeoutMs: 200 });
    const callbacks = makeCallbacks();

    // executeFn that never resolves
    const resultPromise = executeWithWatchdog(
      () => new Promise<string>(() => {}), // Never resolves
      config,
      callbacks,
    );

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(250);

    const result = await resultPromise;

    expect(result.status).toBe("timeout");
    expect(callbacks.timeouts).toHaveLength(1);
    expect(callbacks.timeouts[0].attempt).toBe(1);
    expect(callbacks.timeouts[0].stepName).toBe("test-step");
  });

  it("TestWatchdog_HeartbeatFiresAtCorrectIntervals", async () => {
    const config = makeConfig({
      heartbeatIntervalMs: 50,
      inactivityTimeoutMs: 200,
    });
    const callbacks = makeCallbacks();

    // executeFn that never resolves
    const resultPromise = executeWithWatchdog(
      () => new Promise<string>(() => {}),
      config,
      callbacks,
    );

    // Advance to trigger ~3 heartbeats (50ms, 100ms, 150ms) before timeout at 200ms
    await vi.advanceTimersByTimeAsync(160);

    expect(callbacks.heartbeats.length).toBeGreaterThanOrEqual(3);
    expect(callbacks.heartbeats[0].stepName).toBe("test-step");

    // Let the timeout fire to clean up
    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;
  });

  it("TestWatchdog_HeartbeatStopsAfterCompletion", async () => {
    const config = makeConfig({
      heartbeatIntervalMs: 30,
      inactivityTimeoutMs: 500,
    });
    const callbacks = makeCallbacks();

    let resolveFn: (value: string) => void;
    const resultPromise = executeWithWatchdog(
      () => new Promise<string>((resolve) => { resolveFn = resolve; }),
      config,
      callbacks,
    );

    // Advance so one heartbeat fires
    await vi.advanceTimersByTimeAsync(35);
    const heartbeatsBeforeResolve = callbacks.heartbeats.length;
    expect(heartbeatsBeforeResolve).toBeGreaterThanOrEqual(1);

    // Resolve the function
    resolveFn!("done");
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result.status).toBe("completed");

    // Advance more time — no additional heartbeats should fire
    await vi.advanceTimersByTimeAsync(200);
    expect(callbacks.heartbeats.length).toBe(heartbeatsBeforeResolve);
  });

  it("TestWatchdog_AbortControllerSignaled", async () => {
    const config = makeConfig({ inactivityTimeoutMs: 100 });
    const callbacks = makeCallbacks();

    let capturedAbortController: AbortController | undefined;

    const resultPromise = executeWithWatchdog(
      (abortController) => {
        capturedAbortController = abortController;
        return new Promise<string>(() => {}); // Never resolves
      },
      config,
      callbacks,
    );

    expect(capturedAbortController).toBeDefined();
    expect(capturedAbortController!.signal.aborted).toBe(false);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(150);

    const result = await resultPromise;

    expect(result.status).toBe("timeout");
    expect(capturedAbortController!.signal.aborted).toBe(true);
  });
});

describe("runWithRetries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TestRetries_SucceedsOnSecondAttempt", async () => {
    const config = makeConfig({
      inactivityTimeoutMs: 100,
      heartbeatIntervalMs: 30,
      maxRetries: 2,
    });
    const callbacks = makeCallbacks();

    let callCount = 0;

    const resultPromise = runWithRetries(
      (_abortController) => {
        callCount++;
        if (callCount === 1) {
          // First call: hang (never resolve)
          return new Promise<string>(() => {});
        }
        // Second call: succeed
        return Promise.resolve("success");
      },
      config,
      callbacks,
    );

    // First attempt: advance past timeout
    await vi.advanceTimersByTimeAsync(150);
    // Second attempt resolves immediately
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;

    expect("timedOut" in result).toBe(false);
    if (!("timedOut" in result)) {
      expect(result.result).toBe("success");
      expect(result.attempts).toBe(2);
    }
    expect(callbacks.timeouts).toHaveLength(1);
    expect(callbacks.retries).toHaveLength(1);
  });

  it("TestRetries_ExhaustsAllAttempts", async () => {
    const config = makeConfig({
      inactivityTimeoutMs: 100,
      heartbeatIntervalMs: 30,
      maxRetries: 1,
    });
    const callbacks = makeCallbacks();

    const resultPromise = runWithRetries(
      () => new Promise<string>(() => {}), // Always hangs
      config,
      callbacks,
    );

    // First attempt timeout
    await vi.advanceTimersByTimeAsync(150);
    // Second attempt timeout
    await vi.advanceTimersByTimeAsync(150);

    const result = await resultPromise;

    expect("timedOut" in result).toBe(true);
    if ("timedOut" in result) {
      expect(result.timedOut).toBe(true);
      expect(result.attempts).toBe(2);
    }
    expect(callbacks.timeouts).toHaveLength(2);
    expect(callbacks.retries).toHaveLength(1);
  });

  it("TestRetries_CallbacksCalledCorrectly", async () => {
    const config = makeConfig({
      inactivityTimeoutMs: 100,
      heartbeatIntervalMs: 30,
      maxRetries: 2,
    });
    const callbacks = makeCallbacks();

    let callCount = 0;
    const resultPromise = runWithRetries(
      () => {
        callCount++;
        if (callCount <= 2) return new Promise<string>(() => {});
        return Promise.resolve("ok");
      },
      config,
      callbacks,
    );

    // First timeout
    await vi.advanceTimersByTimeAsync(150);
    // Second timeout
    await vi.advanceTimersByTimeAsync(150);
    // Third attempt succeeds
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;

    expect("timedOut" in result).toBe(false);
    if (!("timedOut" in result)) {
      expect(result.result).toBe("ok");
      expect(result.attempts).toBe(3);
    }

    // 2 timeouts (first two attempts), 2 retries (after first and second timeout)
    expect(callbacks.timeouts).toHaveLength(2);
    expect(callbacks.retries).toHaveLength(2);

    // Heartbeats fired during the hanging attempts
    expect(callbacks.heartbeats.length).toBeGreaterThan(0);
  });

  it("TestRetries_ZeroRetries", async () => {
    const config = makeConfig({
      inactivityTimeoutMs: 100,
      maxRetries: 0,
    });
    const callbacks = makeCallbacks();

    const resultPromise = runWithRetries(
      () => new Promise<string>(() => {}), // Hangs
      config,
      callbacks,
    );

    // Single attempt timeout
    await vi.advanceTimersByTimeAsync(150);

    const result = await resultPromise;

    expect("timedOut" in result).toBe(true);
    if ("timedOut" in result) {
      expect(result.attempts).toBe(1);
    }
    expect(callbacks.timeouts).toHaveLength(1);
    expect(callbacks.retries).toHaveLength(0);
  });
});
