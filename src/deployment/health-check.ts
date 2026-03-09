/**
 * Deployment Health Check
 *
 * Verifies a deployed URL is responding correctly. Supports configurable
 * endpoints, timeout, and retry with backoff for cold starts.
 */

import type { HealthCheckResult } from "./types.js";

export interface HealthCheckOptions {
  /** Base URL of the deployment (e.g., "https://my-app.vercel.app") */
  url: string;
  /** Health endpoint path (default: "/") */
  healthEndpoint?: string;
  /** Timeout per request in ms (default: 10000) */
  timeoutMs?: number;
  /** Number of retries for cold start tolerance (default: 3) */
  retries?: number;
  /** Delay between retries in ms (default: 5000) */
  retryDelayMs?: number;
  /** Injectable fetch function */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Extra headers (e.g., Vercel deployment protection bypass) */
  headers?: Record<string, string>;
}

/**
 * Check if a deployed URL is healthy.
 *
 * Retries with backoff to handle cold starts (common on Vercel, Railway, Fly).
 * Considers any 2xx or 3xx response as healthy — the app is responding.
 */
export async function checkDeploymentHealth(
  opts: HealthCheckOptions,
): Promise<HealthCheckResult> {
  const endpoint = opts.healthEndpoint ?? "/";
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 5_000;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  const fullUrl = new URL(endpoint, opts.url).toString();

  let lastError: string | undefined;
  let lastStatusCode = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(retryDelayMs);
    }

    const start = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchFn(fullUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: opts.headers,
      });

      clearTimeout(timer);

      const responseTimeMs = Date.now() - start;
      lastStatusCode = response.status;

      // 2xx or 3xx = healthy
      if (response.status >= 200 && response.status < 400) {
        return {
          healthy: true,
          statusCode: response.status,
          responseTimeMs,
        };
      }

      lastError = `HTTP ${response.status}`;
    } catch (err) {
      const responseTimeMs = Date.now() - start;
      lastError =
        err instanceof Error ? err.message : String(err);

      // On last attempt, return failure
      if (attempt === retries) {
        return {
          healthy: false,
          statusCode: lastStatusCode,
          responseTimeMs,
          error: lastError,
        };
      }
    }
  }

  return {
    healthy: false,
    statusCode: lastStatusCode,
    responseTimeMs: 0,
    error: lastError ?? "Health check failed after all retries",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
