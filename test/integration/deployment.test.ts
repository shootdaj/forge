/**
 * Deployment Integration Tests
 *
 * Tests the deploy-verify loop with mocked SDK and health check responses.
 * Verifies the interaction between deployer, health checker, and state updates.
 */

import { describe, it, expect, vi } from "vitest";
import { checkDeploymentHealth } from "../../src/deployment/health-check.js";
import { buildDeployPrompt, buildDeployFixPrompt } from "../../src/deployment/prompts.js";

describe("TestDeploymentHealthCheck_RetryBehavior", () => {
  it("recovers from cold start (fail then succeed)", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ status: 200 });

    const result = await checkDeploymentHealth({
      url: "https://cold-start-app.vercel.app",
      fetchFn: mockFetch,
      retries: 2,
      retryDelayMs: 1,
    });

    expect(result.healthy).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("fails after exhausting all retries", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await checkDeploymentHealth({
      url: "https://broken-app.vercel.app",
      fetchFn: mockFetch,
      retries: 2,
      retryDelayMs: 1,
    });

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("ECONNREFUSED");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("TestDeployPrompt_PlatformSpecific", () => {
  it("generates Vercel-specific deploy instructions", () => {
    const prompt = buildDeployPrompt({
      target: "vercel",
      environments: ["production"],
      projectDir: "/project",
    });

    expect(prompt).toContain("vercel");
    expect(prompt).toContain("npx vercel --prod --yes");
    expect(prompt).toContain("DEPLOYED_URL:");
  });

  it("generates Railway-specific deploy instructions", () => {
    const prompt = buildDeployPrompt({
      target: "railway",
      environments: ["production"],
      projectDir: "/project",
    });

    expect(prompt).toContain("railway up");
  });

  it("generates Fly-specific deploy instructions", () => {
    const prompt = buildDeployPrompt({
      target: "fly",
      environments: ["production"],
      projectDir: "/project",
    });

    expect(prompt).toContain("fly deploy");
  });

  it("includes prior attempt errors for retries", () => {
    const prompt = buildDeployPrompt({
      target: "vercel",
      environments: ["production"],
      projectDir: "/project",
      priorAttempts: [
        {
          attempt: 1,
          success: false,
          error: "Build failed: missing env vars",
          costUsd: 0.5,
        },
      ],
    });

    expect(prompt).toContain("Prior deployment attempts");
    expect(prompt).toContain("Build failed: missing env vars");
    expect(prompt).toContain("Fix the issues");
  });
});

describe("TestDeployFixPrompt_DiagnosisContext", () => {
  it("includes health check details for diagnosis", () => {
    const prompt = buildDeployFixPrompt({
      target: "vercel",
      url: "https://my-app.vercel.app",
      healthCheck: { statusCode: 500, error: "Internal Server Error" },
      attempt: 2,
    });

    expect(prompt).toContain("HTTP 500");
    expect(prompt).toContain("Internal Server Error");
    expect(prompt).toContain("attempt 2");
    expect(prompt).toContain("Diagnose and fix");
  });
});
