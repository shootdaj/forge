/**
 * Flutter Startup Lock Mutex (FV-06)
 *
 * Serializes all Flutter CLI invocations to prevent deadlock caused by
 * Flutter's global startup lock (flutter/flutter#16423).
 *
 * Usage: await withFlutterLock(() => execWithTimeout("flutter ...", cwd))
 *
 * Requirement: FV-06
 */

let _lockPromise: Promise<void> = Promise.resolve();

/**
 * Acquire the Flutter startup lock, run fn, then release.
 * Callers are serialized — only one Flutter CLI command runs at a time.
 *
 * @param fn - Async function to run while holding the lock
 * @returns The return value of fn
 */
export async function withFlutterLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Chain onto the current lock promise
  const prev = _lockPromise;
  _lockPromise = acquired;

  // Wait for the previous holder to release
  await prev;

  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Reset the lock state (for testing only).
 * Should not be used in production code.
 */
export function _resetFlutterLock(): void {
  _lockPromise = Promise.resolve();
}
