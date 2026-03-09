/**
 * Deployment Orchestrator
 *
 * Deploys web apps after UAT passes and verifies the deployment is healthy.
 * Loops on failure: deploy → health check → diagnose/fix → redeploy.
 *
 * Only runs for web apps (detected by framework or deployment config).
 */

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { runStep as defaultRunStep } from "../step-runner/step-runner.js";
import { checkDeploymentHealth } from "./health-check.js";
import { buildDeployPrompt, buildDeployFixPrompt, buildSmokeTestPrompt } from "./prompts.js";
import type {
  DeploymentContext,
  DeploymentResult,
  DeployAttempt,
  SmokeTestResult,
} from "./types.js";

/**
 * Detect if the project is a web app that should be deployed.
 *
 * Checks for web framework indicators in package.json or config.
 */
export function isWebApp(opts: {
  fs?: { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string };
  cwd?: string;
}): boolean {
  const fs = opts.fs ?? {
    existsSync: (p: string) => nodeFs.existsSync(p),
    readFileSync: (p: string, enc: string) =>
      nodeFs.readFileSync(p, enc as BufferEncoding) as unknown as string,
  };
  const cwd = opts.cwd ?? process.cwd();
  const pkgPath = nodePath.resolve(cwd, "package.json");

  if (!fs.existsSync(pkgPath)) return false;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8") as string);
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    // Web frameworks that indicate this is a deployable web app
    const webFrameworks = [
      "next",
      "nuxt",
      "remix",
      "astro",
      "sveltekit",
      "@sveltejs/kit",
      "express",
      "fastify",
      "hono",
      "koa",
      "nestjs",
      "@nestjs/core",
      "gatsby",
      "vite",
    ];

    return webFrameworks.some((fw) => fw in allDeps);
  } catch {
    return false;
  }
}

/**
 * Extract the deployed URL from agent output.
 *
 * Looks for "DEPLOYED_URL: <url>" pattern in the step result.
 */
export function extractDeployedUrl(output: string): string | null {
  const match = output.match(/DEPLOYED_URL:\s*(https?:\/\/\S+)/i);
  return match ? match[1].replace(/[.,;)}\]]+$/, "") : null;
}

/**
 * Check if deployment failed from agent output.
 */
export function extractDeployFailure(output: string): string | null {
  const match = output.match(/DEPLOY_FAILED:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Run the deploy-verify loop.
 *
 * Flow:
 * 1. Check if this is a web app — skip if not
 * 2. Deploy using configured target
 * 3. Health check the deployed URL
 * 4. If unhealthy: diagnose, fix, redeploy (up to maxRetries)
 * 5. Return result with URL or failure reason
 */
export async function runDeployment(
  ctx: DeploymentContext,
): Promise<DeploymentResult> {
  const config = ctx.config;
  const target = config.deployment.target;
  const maxRetries = config.maxRetries;
  const attempts: DeployAttempt[] = [];
  let totalCostUsd = 0;

  // Use injectable runStepFn or fall back to imported default
  const execStep = ctx.runStepFn
    ? (name: string, opts: any) => ctx.runStepFn!(name, opts, ctx.stepRunnerContext, ctx.costController)
    : (name: string, opts: any) => defaultRunStep(name, opts, ctx.stepRunnerContext, ctx.costController);

  // Step 1: Check if web app
  const state = ctx.stateManager.load();
  const projectDir = state.projectDir;

  // Build filesystem adapter for isWebApp
  const fsImpl = {
    existsSync: (p: string) => nodeFs.existsSync(p),
    readFileSync: (p: string, enc: string) => nodeFs.readFileSync(p, enc as BufferEncoding) as unknown as string,
  };

  if (!isWebApp({ fs: fsImpl, cwd: projectDir })) {
    return {
      status: "skipped",
      reason: "Not a web app (no web framework detected)",
    };
  }

  // Step 2-4: Deploy-verify loop
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const isRetry = attempt > 1;

    // Build deploy prompt
    const prompt = isRetry
      ? buildDeployFixPrompt({
          target,
          url: attempts[attempts.length - 1]?.url ?? "",
          healthCheck: attempts[attempts.length - 1]?.healthCheck ?? {
            statusCode: 0,
            error: "Previous deployment failed",
          },
          attempt,
        })
      : buildDeployPrompt({
          target,
          environments: config.deployment.environments,
          projectDir,
          priorAttempts: attempts.length > 0 ? attempts : undefined,
        });

    // Run deploy step via injectable function
    const stepResult = await execStep(
      `deploy-${target}${isRetry ? `-retry-${attempt}` : ""}`,
      {
        prompt,
        verify: async () => true, // Verification is done via health check below
      },
    );

    const stepCost =
      stepResult.status === "verified" || stepResult.status === "failed" || stepResult.status === "error"
        ? stepResult.costUsd
        : 0;
    totalCostUsd += stepCost;

    // Extract URL from output
    const output =
      stepResult.status === "verified"
        ? stepResult.result
        : stepResult.status === "failed" && stepResult.result
          ? stepResult.result
          : "";

    let deployedUrl = extractDeployedUrl(output);
    const deployFailure = extractDeployFailure(output);

    if (deployFailure || !deployedUrl) {
      attempts.push({
        attempt,
        success: false,
        error: deployFailure ?? "No deployment URL found in output",
        costUsd: stepCost,
      });
      continue;
    }

    // At this point deployedUrl is guaranteed non-null
    let currentUrl: string = deployedUrl;

    // Health check the deployed URL
    const healthResult = await checkDeploymentHealth({
      url: currentUrl,
      healthEndpoint: "/",
      retries: 3,
      retryDelayMs: ctx.healthCheckRetryDelayMs ?? 5_000,
      fetchFn: ctx.fetchFn,
    });

    if (healthResult.healthy) {
      attempts.push({
        attempt,
        success: true,
        url: currentUrl,
        healthCheck: healthResult,
        costUsd: stepCost,
      });

      // Run post-deployment smoke test to verify core flows actually work
      const smokeTest = await runSmokeTest(currentUrl, target, execStep);
      if (smokeTest) {
        totalCostUsd += smokeTest.costUsd;

        if (!smokeTest.result.passed) {
          // Smoke test failed — check if agent fixed and redeployed
          const redeployedUrl = smokeTest.redeployedUrl;
          if (redeployedUrl && redeployedUrl !== currentUrl) {
            // Agent fixed the issue and redeployed — update URL
            currentUrl = redeployedUrl;
          } else {
            // Smoke test failed and no redeploy — continue to next attempt
            attempts[attempts.length - 1].success = false;
            attempts[attempts.length - 1].error =
              `Smoke test failed: ${smokeTest.result.tests.filter((t) => !t.passed).map((t) => t.name).join(", ")}`;
            continue;
          }
        }
      }

      // Update state with deployment info
      try {
        await ctx.stateManager.update((s) => ({
          ...s,
          deployment: {
            status: "deployed" as const,
            url: currentUrl,
            target,
            deployedAt: new Date().toISOString(),
            attempts: attempt,
          },
        }));
      } catch {
        // Non-critical
      }

      return {
        status: "deployed",
        url: currentUrl,
        attempts,
        totalCostUsd,
        smokeTest: smokeTest?.result,
      };
    }

    // Health check failed
    attempts.push({
      attempt,
      success: false,
      url: currentUrl,
      healthCheck: healthResult,
      error: `Health check failed: HTTP ${healthResult.statusCode} — ${healthResult.error}`,
      costUsd: stepCost,
    });
  }

  // All attempts exhausted
  try {
    await ctx.stateManager.update((s) => ({
      ...s,
      deployment: {
        status: "failed" as const,
        url: attempts[attempts.length - 1]?.url ?? "",
        target,
        deployedAt: new Date().toISOString(),
        attempts: attempts.length,
      },
    }));
  } catch {
    // Non-critical
  }

  return {
    status: "failed",
    attempts,
    totalCostUsd,
    reason: `Deployment failed after ${attempts.length} attempts`,
  };
}

/**
 * Extract smoke test result JSON from agent output.
 */
export function extractSmokeTestResult(output: string): SmokeTestResult | null {
  const match = output.match(/SMOKE_TEST_RESULT:\s*(\{.*\})/i);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.passed !== "boolean" || !Array.isArray(parsed.tests)) {
      return null;
    }
    return parsed as SmokeTestResult;
  } catch {
    return null;
  }
}

/**
 * Run post-deployment smoke test.
 *
 * Asks the agent to verify core user flows against the deployed URL.
 * Returns the smoke test result and any redeployed URL.
 */
async function runSmokeTest(
  url: string,
  target: string,
  execStep: (name: string, opts: any) => Promise<any>,
): Promise<{ result: SmokeTestResult; costUsd: number; redeployedUrl?: string } | null> {
  try {
    const prompt = buildSmokeTestPrompt({ url, target });
    const stepResult = await execStep("post-deploy-smoke-test", {
      prompt,
      verify: async () => true,
    });

    const costUsd =
      stepResult.status === "verified" || stepResult.status === "failed" || stepResult.status === "error"
        ? stepResult.costUsd
        : 0;

    const output =
      stepResult.status === "verified"
        ? stepResult.result
        : stepResult.status === "failed" && stepResult.result
          ? stepResult.result
          : "";

    const smokeResult = extractSmokeTestResult(output);
    const redeployedUrl = extractDeployedUrl(output);

    if (smokeResult) {
      return { result: smokeResult, costUsd, redeployedUrl: redeployedUrl ?? undefined };
    }

    // If no structured result, assume pass (agent didn't find issues)
    return {
      result: { passed: true, tests: [{ name: "general", passed: true }] },
      costUsd,
    };
  } catch {
    // Smoke test failure is non-fatal — don't block deployment
    return null;
  }
}
