/**
 * Deployment Scenario Tests
 *
 * End-to-end scenarios for the deployment module. Tests the full
 * deploy-verify-fix loop as it would run in the pipeline.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isWebApp,
  extractDeployedUrl,
  extractDeployFailure,
} from "../../src/deployment/deployer.js";
import { checkDeploymentHealth } from "../../src/deployment/health-check.js";
import { buildDeployPrompt, buildDeployFixPrompt } from "../../src/deployment/prompts.js";

describe("TestDeploymentScenario_WebAppDetection", () => {
  it("correctly classifies web vs non-web projects", () => {
    const webFrameworks = [
      { next: "14.0.0" },
      { express: "4.18.0" },
      { fastify: "4.0.0" },
      { hono: "3.0.0" },
      { "@nestjs/core": "10.0.0" },
      { nuxt: "3.0.0" },
      { remix: "2.0.0" },
      { astro: "4.0.0" },
    ];

    for (const deps of webFrameworks) {
      const fs = {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ dependencies: deps }),
      };
      expect(isWebApp({ fs, cwd: "/p" })).toBe(true);
    }

    // Non-web
    const nonWebDeps = [
      { commander: "11.0.0" },
      { zod: "3.0.0" },
      { typescript: "5.0.0" },
      { esbuild: "0.20.0" },
    ];

    for (const deps of nonWebDeps) {
      const fs = {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ dependencies: deps }),
      };
      expect(isWebApp({ fs, cwd: "/p" })).toBe(false);
    }
  });
});

describe("TestDeploymentScenario_FullDeployVerifyLoop", () => {
  it("simulates successful deploy → health check flow", async () => {
    // Step 1: Agent deploys and returns URL
    const agentOutput = [
      "Building project...",
      "Deploying to Vercel...",
      "DEPLOYED_URL: https://my-app-abc123.vercel.app",
      "Deployment complete!",
    ].join("\n");

    const url = extractDeployedUrl(agentOutput);
    expect(url).toBe("https://my-app-abc123.vercel.app");
    expect(extractDeployFailure(agentOutput)).toBeNull();

    // Step 2: Health check the deployed URL
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    const health = await checkDeploymentHealth({
      url: url!,
      fetchFn: mockFetch,
      retries: 0,
    });
    expect(health.healthy).toBe(true);
  });

  it("simulates deploy failure → fix → redeploy flow", async () => {
    // Attempt 1: Deploy succeeds but health check fails
    const output1 = "DEPLOYED_URL: https://broken.vercel.app";
    const url1 = extractDeployedUrl(output1)!;

    const mockFetch1 = vi.fn().mockResolvedValue({ status: 500 });
    const health1 = await checkDeploymentHealth({
      url: url1,
      fetchFn: mockFetch1,
      retries: 0,
    });
    expect(health1.healthy).toBe(false);

    // Generate fix prompt with failure context
    const fixPrompt = buildDeployFixPrompt({
      target: "vercel",
      url: url1,
      healthCheck: { statusCode: 500, error: "Internal Server Error" },
      attempt: 2,
    });
    expect(fixPrompt).toContain("500");
    expect(fixPrompt).toContain("Diagnose and fix");

    // Attempt 2: Agent fixes and redeploys
    const output2 = "Fixed env vars\nDEPLOYED_URL: https://fixed.vercel.app";
    const url2 = extractDeployedUrl(output2)!;

    const mockFetch2 = vi.fn().mockResolvedValue({ status: 200 });
    const health2 = await checkDeploymentHealth({
      url: url2,
      fetchFn: mockFetch2,
      retries: 0,
    });
    expect(health2.healthy).toBe(true);
  });

  it("simulates deploy command failure (no URL)", () => {
    const output = "Error: vercel not installed\nDEPLOY_FAILED: Vercel CLI not found";
    const url = extractDeployedUrl(output);
    const failure = extractDeployFailure(output);

    expect(url).toBeNull();
    expect(failure).toBe("Vercel CLI not found");
  });
});

describe("TestDeploymentScenario_PlatformPrompts", () => {
  it("generates correct prompts for each supported platform", () => {
    const platforms = ["vercel", "railway", "fly", "netlify", "other"];

    for (const target of platforms) {
      const prompt = buildDeployPrompt({
        target,
        environments: ["production"],
        projectDir: "/project",
      });

      // All prompts should have these common elements
      expect(prompt).toContain("Deploy this web application");
      expect(prompt).toContain("DEPLOYED_URL:");
      expect(prompt).toContain("DEPLOY_FAILED:");
      expect(prompt).toContain(target);
    }
  });
});
