/**
 * Deployment E2E Scenario Tests
 *
 * Tests the full deploy-verify loop against 3 moderately complex web apps
 * and 1 CLI tool (negative case). Each test creates a real temp directory
 * with a package.json, then runs runDeployment with mocked agent + health checks.
 *
 * Proves: software isn't done until the user can access it via a deployed URL,
 * and the loop keeps retrying until that's true.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runDeployment } from "../../src/deployment/deployer.js";
import type { DeploymentContext } from "../../src/deployment/types.js";
import type { ForgeState } from "../../src/state/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp project dir with package.json */
function createTempProject(deps: Record<string, string>, devDeps?: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-deploy-test-"));
  const pkg: Record<string, unknown> = { name: "test-app", version: "1.0.0" };
  if (Object.keys(deps).length > 0) pkg.dependencies = deps;
  if (devDeps && Object.keys(devDeps).length > 0) pkg.devDependencies = devDeps;
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  return dir;
}

/** Build a mock ForgeState pointing at a project dir */
function mockState(projectDir: string): ForgeState {
  return {
    projectDir,
    startedAt: new Date().toISOString(),
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "uat",
    currentWave: 4,
    projectInitialized: true,
    scaffolded: true,
    phases: {},
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: { totalRequirements: 10, verified: 10, gapHistory: [0], roundsCompleted: 1 },
    remainingGaps: [],
    uatResults: { status: "passed", workflowsTested: 5, workflowsPassed: 5, workflowsFailed: 0 },
    deployment: { status: "not_started", url: "", target: "", attempts: 0 },
    totalBudgetUsed: 8.5,
  };
}

/** Build a DeploymentContext with injectable fns */
function buildCtx(opts: {
  projectDir: string;
  target?: string;
  maxRetries?: number;
  runStepFn: (...args: any[]) => Promise<any>;
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
}): DeploymentContext {
  const state = mockState(opts.projectDir);
  const stateUpdates: Array<Partial<ForgeState>> = [];

  return {
    config: {
      model: "claude-opus-4-6",
      maxBudgetTotal: 200,
      maxBudgetPerStep: 15,
      maxRetries: opts.maxRetries ?? 3,
      maxComplianceRounds: 5,
      maxTurnsPerStep: 200,
      testing: {
        stack: "node",
        unitCommand: "npm test",
        integrationCommand: "npm run test:integration",
        scenarioCommand: "npm run test:e2e",
        dockerComposeFile: "docker-compose.test.yml",
      },
      verification: {
        files: true, tests: true, typecheck: true, lint: true,
        dockerSmoke: false, testCoverageCheck: true, observabilityCheck: false, deployment: false,
      },
      notion: {
        parentPageId: "",
        docPages: { architecture: "", dataFlow: "", apiReference: "", componentIndex: "", adrs: "", deployment: "", devWorkflow: "", phaseReports: "" },
      },
      parallelism: { maxConcurrentPhases: 3, enableSubagents: true, backgroundDocs: true },
      deployment: { target: opts.target ?? "vercel", environments: ["production"] },
      notifications: { onHumanNeeded: "stdout", onPhaseComplete: "stdout", onFailure: "stdout" },
    },
    stateManager: {
      load: () => state,
      update: vi.fn(async (fn: (s: ForgeState) => ForgeState) => {
        const updated = fn(state);
        Object.assign(state, updated);
        stateUpdates.push(updated);
      }),
    } as any,
    stepRunnerContext: { config: {} as any, stateManager: {} as any, executeQueryFn: vi.fn() },
    costController: {
      recordStepCost: vi.fn(),
      getCostLog: () => [],
      getTotalCostUsd: () => 8.5,
      isOverBudget: () => false,
    } as any,
    runStepFn: opts.runStepFn,
    fetchFn: opts.fetchFn,
    healthCheckRetryDelayMs: 1, // fast retries for tests
  };
}

/** Make a step result that looks like a verified deployment output */
function verifiedStep(output: string, cost = 1.5) {
  return {
    status: "verified" as const,
    costUsd: cost,
    costData: { totalCostUsd: cost },
    result: output,
    structuredOutput: null,
    sessionId: "test-session",
  };
}

/** Make a step result that looks like a failed step */
function failedStep(output: string, cost = 0.8) {
  return {
    status: "failed" as const,
    costUsd: cost,
    costData: { totalCostUsd: cost },
    mayHavePartialWork: false,
    error: "Deploy step failed",
    result: output,
    sessionId: "test-session",
  };
}

// ---------------------------------------------------------------------------
// App 1: Next.js SaaS with Prisma + Stripe
// Scenario: First deploy fails (500 — missing DATABASE_URL), agent fixes
// env vars on retry, second deploy succeeds with healthy response.
// ---------------------------------------------------------------------------

describe("TestDeployE2E_NextJsSaasApp", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject(
      { next: "14.2.0", react: "18.3.0", "react-dom": "18.3.0", "@prisma/client": "5.10.0", stripe: "14.0.0" },
      { prisma: "5.10.0", typescript: "5.4.0", tailwindcss: "3.4.0" },
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("detects as web app and deploys on second attempt after fixing env vars", async () => {
    let stepCallCount = 0;

    const mockRunStep = vi.fn(async (name: string) => {
      stepCallCount++;
      if (stepCallCount === 1) {
        // First deploy: app deploys but health check will fail (simulated by fetch)
        return verifiedStep([
          "Building Next.js app...",
          "✓ Compiled successfully",
          "Deploying to Vercel...",
          "DEPLOYED_URL: https://saas-app-abc123.vercel.app",
        ].join("\n"));
      }
      // Second deploy: agent found missing DATABASE_URL, fixed it, redeployed
      return verifiedStep([
        "Found issue: DATABASE_URL not set in Vercel env vars",
        "Added DATABASE_URL to Vercel project settings",
        "Redeploying...",
        "DEPLOYED_URL: https://saas-app-abc123.vercel.app",
      ].join("\n"));
    });

    let fetchCallCount = 0;
    const mockFetch = vi.fn(async () => {
      fetchCallCount++;
      // First 4 calls (attempt 1: initial + 3 retries) → 500
      if (fetchCallCount <= 4) {
        return { status: 500 } as Response;
      }
      // After fix: 200
      return { status: 200 } as Response;
    });

    const ctx = buildCtx({
      projectDir,
      target: "vercel",
      runStepFn: mockRunStep,
      fetchFn: mockFetch,
    });

    const result = await runDeployment(ctx);

    // Verify deployment succeeded
    expect(result.status).toBe("deployed");
    if (result.status !== "deployed") throw new Error("Expected deployed");

    expect(result.url).toBe("https://saas-app-abc123.vercel.app");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[0].error).toContain("Health check failed");
    expect(result.attempts[1].success).toBe(true);
    expect(result.totalCostUsd).toBeGreaterThan(0);

    // Verify state was updated with deployment info
    const state = ctx.stateManager.load();
    expect(state.deployment.status).toBe("deployed");
    expect(state.deployment.url).toBe("https://saas-app-abc123.vercel.app");
    expect(state.deployment.target).toBe("vercel");

    // Verify the retry used a fix prompt (not the initial deploy prompt)
    const secondCallPrompt = mockRunStep.mock.calls[1];
    expect(secondCallPrompt[0]).toContain("retry");
  });
});

// ---------------------------------------------------------------------------
// App 2: Express REST API with MongoDB + Redis
// Scenario: Deploy succeeds first time. Health check fails on first attempt
// (cold start), then passes on retry. Single deployment attempt.
// ---------------------------------------------------------------------------

describe("TestDeployE2E_ExpressApiApp", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject(
      { express: "4.18.2", mongoose: "8.2.0", ioredis: "5.3.0", cors: "2.8.5", helmet: "7.1.0" },
      { typescript: "5.4.0", "ts-node": "10.9.0", vitest: "1.3.0" },
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("deploys to Railway on first attempt with cold start recovery", async () => {
    const mockRunStep = vi.fn(async () =>
      verifiedStep([
        "Building TypeScript project...",
        "Setting up Railway deployment...",
        "Pushing to Railway...",
        "DEPLOYED_URL: https://api-production-abc123.up.railway.app",
        "Deployment live!",
      ].join("\n"), 2.1),
    );

    let fetchCallCount = 0;
    const mockFetch = vi.fn(async () => {
      fetchCallCount++;
      // Cold start: first 2 attempts fail, third succeeds
      if (fetchCallCount <= 2) {
        throw new Error("ECONNREFUSED");
      }
      return { status: 200 } as Response;
    });

    const ctx = buildCtx({
      projectDir,
      target: "railway",
      runStepFn: mockRunStep,
      fetchFn: mockFetch,
    });

    const result = await runDeployment(ctx);

    expect(result.status).toBe("deployed");
    if (result.status !== "deployed") throw new Error("Expected deployed");

    expect(result.url).toBe("https://api-production-abc123.up.railway.app");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].success).toBe(true);
    expect(result.attempts[0].healthCheck?.healthy).toBe(true);

    // Only 1 step call — deployed on first attempt
    expect(mockRunStep).toHaveBeenCalledOnce();

    // Health check retried (ECONNREFUSED → ECONNREFUSED → 200)
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // State updated
    const state = ctx.stateManager.load();
    expect(state.deployment.status).toBe("deployed");
    expect(state.deployment.target).toBe("railway");
  });
});

// ---------------------------------------------------------------------------
// App 3: Remix + Drizzle full-stack app on Fly.io
// Scenario: First deploy fails entirely (Fly CLI not installed, no URL).
// Second attempt: deploys but returns 502 (bad gateway — app crashes on start).
// Third attempt: agent fixes the crash, redeploys, health check passes.
// Tests the full 3-attempt retry loop.
// ---------------------------------------------------------------------------

describe("TestDeployE2E_RemixFullStackApp", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject(
      { "@remix-run/node": "2.8.0", "@remix-run/react": "2.8.0", "drizzle-orm": "0.30.0", "better-sqlite3": "11.0.0" },
      { "@remix-run/dev": "2.8.0", typescript: "5.4.0", vite: "5.2.0" },
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("retries 3 times before succeeding on third attempt", async () => {
    let stepCallCount = 0;

    const mockRunStep = vi.fn(async () => {
      stepCallCount++;
      switch (stepCallCount) {
        case 1:
          // Attempt 1: Fly CLI not found
          return verifiedStep(
            "Error: fly command not found\nDEPLOY_FAILED: Fly CLI not installed. Run `curl -L https://fly.io/install.sh | sh`",
            0.3,
          );
        case 2:
          // Attempt 2: installed Fly, deployed, but app crashes
          return verifiedStep([
            "Installed Fly CLI",
            "Created fly.toml",
            "Deploying to Fly.io...",
            "DEPLOYED_URL: https://remix-app.fly.dev",
          ].join("\n"), 1.8);
        case 3:
          // Attempt 3: fixed the crash, redeployed
          return verifiedStep([
            "Found crash: missing DATABASE_URL in fly secrets",
            "Set fly secret: DATABASE_URL",
            "Redeploying...",
            "DEPLOYED_URL: https://remix-app.fly.dev",
          ].join("\n"), 1.2);
        default:
          return verifiedStep("DEPLOYED_URL: https://remix-app.fly.dev");
      }
    });

    let fetchCallCount = 0;
    const mockFetch = vi.fn(async () => {
      fetchCallCount++;
      // Attempt 2 health checks: all return 502 (4 calls: initial + 3 retries)
      if (fetchCallCount <= 4) {
        return { status: 502 } as Response;
      }
      // Attempt 3: healthy
      return { status: 200 } as Response;
    });

    const ctx = buildCtx({
      projectDir,
      target: "fly",
      maxRetries: 3,
      runStepFn: mockRunStep,
      fetchFn: mockFetch,
    });

    const result = await runDeployment(ctx);

    expect(result.status).toBe("deployed");
    if (result.status !== "deployed") throw new Error("Expected deployed");

    expect(result.url).toBe("https://remix-app.fly.dev");
    expect(result.attempts).toHaveLength(3);

    // Attempt 1: no URL (Fly CLI not installed)
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[0].error).toContain("Fly CLI not installed");
    expect(result.attempts[0].url).toBeUndefined();

    // Attempt 2: deployed but unhealthy (502)
    expect(result.attempts[1].success).toBe(false);
    expect(result.attempts[1].url).toBe("https://remix-app.fly.dev");
    expect(result.attempts[1].healthCheck?.statusCode).toBe(502);

    // Attempt 3: fixed and healthy
    expect(result.attempts[2].success).toBe(true);
    expect(result.attempts[2].url).toBe("https://remix-app.fly.dev");
    expect(result.attempts[2].healthCheck?.healthy).toBe(true);

    // Cost accumulated across all attempts
    expect(result.totalCostUsd).toBeCloseTo(0.3 + 1.8 + 1.2, 1);

    // State reflects success
    const state = ctx.stateManager.load();
    expect(state.deployment.status).toBe("deployed");
    expect(state.deployment.attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// App 4 (negative case): CLI tool — deployment should be skipped
// ---------------------------------------------------------------------------

describe("TestDeployE2E_CliToolSkipped", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject(
      { commander: "12.0.0", chalk: "5.3.0", zod: "3.22.0", glob: "10.3.0" },
      { typescript: "5.4.0", vitest: "1.3.0", tsup: "8.0.0" },
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("skips deployment for non-web CLI tool", async () => {
    const mockRunStep = vi.fn();
    const mockFetch = vi.fn();

    const ctx = buildCtx({
      projectDir,
      runStepFn: mockRunStep,
      fetchFn: mockFetch,
    });

    const result = await runDeployment(ctx);

    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("Expected skipped");
    expect(result.reason).toContain("Not a web app");

    // No deploy step or health check should have been called
    expect(mockRunStep).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// App 5: Exhausted retries — all attempts fail
// Proves the loop terminates and returns "failed" with full history
// ---------------------------------------------------------------------------

describe("TestDeployE2E_AllAttemptsFail", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject(
      { next: "14.2.0", react: "18.3.0", "react-dom": "18.3.0" },
    );
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("fails after exhausting all retry attempts", async () => {
    const mockRunStep = vi.fn(async () =>
      verifiedStep("DEPLOYED_URL: https://broken-forever.vercel.app", 1.0),
    );

    // Always returns 500 — app is fundamentally broken
    const mockFetch = vi.fn(async () => ({ status: 500 } as Response));

    const ctx = buildCtx({
      projectDir,
      target: "vercel",
      maxRetries: 2, // 3 total attempts
      runStepFn: mockRunStep,
      fetchFn: mockFetch,
    });

    const result = await runDeployment(ctx);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected failed");

    expect(result.attempts).toHaveLength(3); // 1 initial + 2 retries
    expect(result.attempts.every(a => !a.success)).toBe(true);
    expect(result.reason).toContain("failed after 3 attempts");
    expect(result.totalCostUsd).toBeCloseTo(3.0, 1);

    // State reflects failure
    const state = ctx.stateManager.load();
    expect(state.deployment.status).toBe("failed");
    expect(state.deployment.attempts).toBe(3);
  });
});
