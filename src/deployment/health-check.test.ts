/**
 * Health Check Tests
 *
 * Unit tests for deployment health check functionality.
 */

import { describe, it, expect, vi } from "vitest";
import { checkDeploymentHealth } from "./health-check.js";

describe("checkDeploymentHealth", () => {
  it("returns healthy for 200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    });

    const result = await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 0,
    });

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns healthy for 301 redirect", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 301 });

    const result = await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 0,
    });

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(301);
  });

  it("returns unhealthy for 500 error after retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 500 });

    const result = await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 1,
      retryDelayMs: 1, // fast for tests
    });

    expect(result.healthy).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("returns unhealthy on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 0,
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ status: 200 });

    const result = await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 1,
      retryDelayMs: 1,
    });

    expect(result.healthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses custom health endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

    await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      healthEndpoint: "/api/health",
      fetchFn: mockFetch,
      retries: 0,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-app.vercel.app/api/health",
      expect.any(Object),
    );
  });

  it("uses root path by default", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

    await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 0,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-app.vercel.app/",
      expect.any(Object),
    );
  });

  it("passes custom headers (e.g., Vercel protection bypass)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

    await checkDeploymentHealth({
      url: "https://my-app.vercel.app",
      fetchFn: mockFetch,
      retries: 0,
      headers: { "x-vercel-protection-bypass": "secret123" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-app.vercel.app/",
      expect.objectContaining({
        headers: { "x-vercel-protection-bypass": "secret123" },
      }),
    );
  });
});
