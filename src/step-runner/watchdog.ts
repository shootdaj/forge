/**
 * Session Watchdog
 *
 * Wraps executeQuery calls with inactivity timeout detection,
 * heartbeat emission, session abort, and retry logic.
 *
 * The watchdog monitors entire SDK sessions at the step runner level.
 * If a session produces no output for a configurable timeout period,
 * the session is killed via AbortController and retried with fresh context.
 *
 * Requirements: Phase 15 — Session Watchdog
 */

/**
 * Configuration for the watchdog timer.
 */
export interface WatchdogConfig {
  /** Milliseconds of inactivity before killing the session */
  inactivityTimeoutMs: number;
  /** Milliseconds between heartbeat emissions during inactivity */
  heartbeatIntervalMs: number;
  /** Maximum number of retries after timeout (0 = no retries) */
  maxRetries: number;
  /** Name of the step being watched (for logging) */
  stepName: string;
}

/**
 * Result from a single watchdog-guarded execution attempt.
 */
export type WatchdogResult<T> =
  | { status: "completed"; result: T }
  | { status: "timeout"; attempt: number; elapsedMs: number };

/**
 * Callbacks invoked by the watchdog during execution.
 */
export interface WatchdogCallbacks {
  /** Called periodically during inactivity */
  onHeartbeat: (secondsSinceLastActivity: number, stepName: string) => void;
  /** Called when a session is killed due to inactivity */
  onTimeout: (attempt: number, stepName: string) => void;
  /** Called before retrying after a timeout */
  onRetry: (attempt: number, stepName: string) => void;
}

/**
 * Execute a function with watchdog inactivity timeout and heartbeat.
 *
 * Creates an AbortController for the execution. If the function does not
 * complete within `inactivityTimeoutMs`, the AbortController is aborted
 * and the function is considered timed out.
 *
 * During the wait, heartbeat callbacks fire every `heartbeatIntervalMs`
 * to signal that the watchdog is alive and monitoring.
 *
 * @param executeFn - Function to execute, receives an AbortController
 * @param config - Watchdog timing configuration
 * @param callbacks - Event callbacks for heartbeat, timeout, retry
 * @returns WatchdogResult indicating completion or timeout
 */
export async function executeWithWatchdog<T>(
  executeFn: (abortController: AbortController) => Promise<T>,
  config: WatchdogConfig,
  callbacks: WatchdogCallbacks,
  attempt: number = 1,
): Promise<WatchdogResult<T>> {
  const abortController = new AbortController();
  const startTime = Date.now();

  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  // Track whether we've already resolved (prevent double-fire)
  let settled = false;

  return new Promise<WatchdogResult<T>>((resolve) => {
    // Start heartbeat timer
    heartbeatTimer = setInterval(() => {
      if (settled) return;
      const elapsedMs = Date.now() - startTime;
      const elapsedSeconds = Math.round(elapsedMs / 1000);
      callbacks.onHeartbeat(elapsedSeconds, config.stepName);
    }, config.heartbeatIntervalMs);

    // Start inactivity timeout
    timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const elapsedMs = Date.now() - startTime;

      // Clear timers
      if (heartbeatTimer) clearInterval(heartbeatTimer);

      // Abort the running session
      abortController.abort();

      callbacks.onTimeout(attempt, config.stepName);

      resolve({ status: "timeout", attempt, elapsedMs });
    }, config.inactivityTimeoutMs);

    // Run the actual function
    executeFn(abortController)
      .then((result) => {
        if (settled) return; // Already timed out
        settled = true;

        // Clear timers
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);

        resolve({ status: "completed", result });
      })
      .catch((error) => {
        if (settled) return; // Already timed out
        settled = true;

        // Clear timers
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);

        // Re-throw as a completed result with the error
        // The caller (step runner) handles query errors through QueryResult
        // If the executeFn itself throws (not an SDK error), we need to propagate
        throw error;
      });
  });
}

/**
 * Execute a function with watchdog protection and automatic retries.
 *
 * Runs the function up to `maxRetries + 1` times (1 initial + N retries).
 * Each attempt is independently guarded by the watchdog timeout.
 * If all attempts time out, returns a timeout indicator.
 *
 * @param executeFn - Function to execute per attempt
 * @param config - Watchdog configuration including retry count
 * @param callbacks - Event callbacks
 * @returns Either the successful result with attempt count, or a timeout indicator
 */
export async function runWithRetries<T>(
  executeFn: (abortController: AbortController) => Promise<T>,
  config: WatchdogConfig,
  callbacks: WatchdogCallbacks,
): Promise<{ result: T; attempts: number } | { timedOut: true; attempts: number }> {
  const maxAttempts = config.maxRetries + 1; // 1 initial + N retries

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const watchdogResult = await executeWithWatchdog(
      executeFn,
      config,
      callbacks,
      attempt,
    );

    if (watchdogResult.status === "completed") {
      return { result: watchdogResult.result, attempts: attempt };
    }

    // Timed out — retry if we have attempts left
    if (attempt < maxAttempts) {
      callbacks.onRetry(attempt, config.stepName);
    }
  }

  // All attempts exhausted
  return { timedOut: true, attempts: maxAttempts };
}
