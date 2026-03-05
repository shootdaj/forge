/**
 * UAT Runner
 *
 * Main UAT execution module. Spins up the application via Docker,
 * extracts user workflows from requirements, tests each workflow
 * end-to-end, enforces safety guardrails, and integrates gap closure.
 *
 * Requirements: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
 */

import * as nodeFs from "node:fs";
import { execSync } from "node:child_process";
import type { ForgeConfig } from "../config/schema.js";
import type {
  AppType,
  UATWorkflow,
  WorkflowResult,
  UATResult,
  UATContext,
  SafetyConfig,
} from "./types.js";
import { extractUserWorkflows, buildSafetyPrompt, runUATGapClosure } from "./workflows.js";
import { runStep as defaultRunStep } from "../step-runner/step-runner.js";
import { BudgetExceededError } from "../step-runner/types.js";

/**
 * Detect the application type from the project configuration.
 *
 * Inspects config.testing.stack and maps it to one of: "web", "api", "cli".
 *
 * Requirement: UAT-02
 *
 * @param config - Project configuration
 * @returns Detected app type
 */
export function detectAppType(config: ForgeConfig): AppType {
  const stack = config.testing.stack.toLowerCase();

  // Web application stacks
  const webStacks = ["react", "next", "nextjs", "vue", "angular", "svelte", "remix", "gatsby", "nuxt"];
  if (webStacks.some((s) => stack.includes(s))) {
    return "web";
  }

  // API/backend stacks
  const apiStacks = ["express", "fastify", "nestjs", "nest", "django", "flask", "rails", "koa", "hapi", "spring"];
  if (apiStacks.some((s) => stack.includes(s))) {
    return "api";
  }

  // Everything else is CLI (node, python, go, rust, etc.)
  return "cli";
}

/**
 * Start the application stack for UAT testing.
 *
 * If a docker-compose file exists, runs `docker compose up -d`.
 * If no docker-compose file exists, assumes the app can be tested directly.
 *
 * Requirement: UAT-01
 *
 * @param config - Project configuration
 * @param ctx - UAT context with injectable filesystem and exec
 * @returns true on success, false on failure
 */
export async function startApplication(
  config: ForgeConfig,
  ctx: UATContext,
): Promise<boolean> {
  const fs = ctx.fs ?? nodeFs;
  const exec = ctx.execFn ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8" }));

  const composeFile = config.testing.dockerComposeFile;

  if (!fs.existsSync(composeFile)) {
    // No docker-compose file -- assume app can be tested directly
    return true;
  }

  try {
    exec(`docker compose -f ${composeFile} up -d`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the application stack after UAT testing.
 *
 * Runs `docker compose down` if the docker-compose file exists.
 * Catches errors silently -- teardown failures are not fatal.
 *
 * Requirement: UAT-01
 *
 * @param config - Project configuration
 * @param ctx - UAT context with injectable filesystem and exec
 */
export async function stopApplication(
  config: ForgeConfig,
  ctx: UATContext,
): Promise<void> {
  const fs = ctx.fs ?? nodeFs;
  const exec = ctx.execFn ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8" }));

  const composeFile = config.testing.dockerComposeFile;

  if (!fs.existsSync(composeFile)) {
    return;
  }

  try {
    exec(`docker compose -f ${composeFile} down`);
  } catch {
    // Teardown errors are non-fatal
  }
}

/**
 * Wait for the application health endpoint to respond.
 *
 * Polls the health URL every 2 seconds up to timeoutMs.
 * Uses the injected execFn to run curl commands.
 *
 * Requirement: UAT-01
 *
 * @param healthUrl - URL to poll for health
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param ctx - UAT context with injectable exec function
 * @returns true when healthy, false on timeout
 */
export async function waitForHealth(
  healthUrl: string,
  timeoutMs: number,
  ctx: UATContext,
): Promise<boolean> {
  const exec = ctx.execFn ?? ((cmd: string) => execSync(cmd, { encoding: "utf-8" }));
  const pollIntervalMs = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      exec(`curl -sf ${healthUrl}`);
      return true;
    } catch {
      // Health check failed, wait and retry
      if (Date.now() - startTime + pollIntervalMs >= timeoutMs) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return false;
}

/**
 * Build the test prompt for a single UAT workflow.
 *
 * Generates app-type-specific testing instructions:
 * - "web": headless browser testing (Playwright via agent-browser CLI)
 * - "api": HTTP testing via curl/fetch
 * - "cli": shell command testing with stdout/stderr/exit code checks
 *
 * Requirement: UAT-02, UAT-03
 *
 * @param workflow - The workflow to test
 * @param appType - Application type
 * @param safetyPrompt - Safety guardrail prompt text
 * @returns Complete test prompt string
 */
export function buildUATPrompt(
  workflow: UATWorkflow,
  appType: AppType,
  safetyPrompt: string,
): string {
  const lines: string[] = [
    `## UAT Test: ${workflow.id}`,
    "",
    `**Requirement:** ${workflow.requirementId}`,
    `**Description:** ${workflow.description}`,
    "",
    "## Test Steps",
    "",
  ];

  workflow.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`);
  });

  lines.push("");
  lines.push("## Testing Strategy");
  lines.push("");

  switch (appType) {
    case "web":
      lines.push(
        "Use a headless browser (Playwright via agent-browser CLI) to test this workflow.",
      );
      lines.push(
        "Navigate to pages, interact with elements, verify visual state and DOM content.",
      );
      lines.push(
        "Take screenshots at key checkpoints for verification evidence.",
      );
      break;
    case "api":
      lines.push(
        "Use curl or fetch via bash to test this API workflow.",
      );
      lines.push(
        "Send HTTP requests, verify response status codes, check response body content.",
      );
      lines.push(
        "Test both success paths and error cases with appropriate HTTP methods.",
      );
      break;
    case "cli":
      lines.push(
        "Run commands in the shell and verify behavior via stdout, stderr, and exit codes.",
      );
      lines.push(
        "Check that command output matches expected patterns.",
      );
      lines.push(
        "Verify file system side effects (created files, modified files) as appropriate.",
      );
      break;
  }

  lines.push("");
  lines.push("## Output");
  lines.push("");
  lines.push(
    `Write the test results as JSON to \`.forge/uat/${workflow.id}.json\` with this format:`,
  );
  lines.push("```json");
  lines.push("{");
  lines.push('  "passed": true | false,');
  lines.push('  "stepsPassed": <number>,');
  lines.push('  "stepsFailed": <number>,');
  lines.push('  "errors": ["error message 1", ...]');
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push(safetyPrompt);

  return lines.join("\n");
}

/**
 * Read and verify UAT results for a single workflow.
 *
 * Reads `.forge/uat/{workflowId}.json` from the filesystem and
 * parses it into a WorkflowResult. Returns a failed result if the
 * file doesn't exist or contains invalid JSON.
 *
 * Requirement: UAT-03
 *
 * @param workflowId - ID of the workflow
 * @param forgeDir - Path to .forge directory
 * @param ctx - UAT context with injectable filesystem
 * @returns WorkflowResult parsed from JSON or a failure result
 */
export function verifyUATResults(
  workflowId: string,
  forgeDir: string,
  ctx: UATContext,
): WorkflowResult {
  const fs = ctx.fs ?? nodeFs;
  const resultPath = `${forgeDir}/uat/${workflowId}.json`;

  if (!fs.existsSync(resultPath)) {
    return {
      workflowId,
      passed: false,
      stepsPassed: 0,
      stepsFailed: 1,
      errors: [`Result file not found: ${resultPath}`],
      durationMs: 0,
    };
  }

  try {
    const content = fs.readFileSync(resultPath, "utf-8");
    const data = JSON.parse(content) as {
      passed?: boolean;
      stepsPassed?: number;
      stepsFailed?: number;
      errors?: string[];
    };

    return {
      workflowId,
      passed: data.passed === true,
      stepsPassed: data.stepsPassed ?? 0,
      stepsFailed: data.stepsFailed ?? 0,
      errors: data.errors ?? [],
      durationMs: 0,
    };
  } catch {
    return {
      workflowId,
      passed: false,
      stepsPassed: 0,
      stepsFailed: 1,
      errors: [`Failed to parse result file: ${resultPath}`],
      durationMs: 0,
    };
  }
}

/**
 * Main UAT entry point. Orchestrates the full UAT lifecycle.
 *
 * Flow:
 * 1. Read REQUIREMENTS.md
 * 2. Detect app type from config
 * 3. Extract workflows from requirements
 * 4. Build safety config and prompt
 * 5. Start application via Docker
 * 6. Wait for health check
 * 7. For each workflow: run test step, verify results
 * 8. Stop application
 * 9. Aggregate results
 * 10. If failures: run gap closure, retry failed workflows
 * 11. Update state with final results
 * 12. Return UATResult
 *
 * Requirements: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
 *
 * @param ctx - UAT context with all dependencies
 * @returns Aggregate UAT result
 */
export async function runUAT(ctx: UATContext): Promise<UATResult> {
  const fs = ctx.fs ?? nodeFs;
  const { config, stateManager, stepRunnerContext, costController } = ctx;
  const executeStep = ctx.runStepFn ?? defaultRunStep;

  // 1. Read REQUIREMENTS.md
  const requirementsPath = config.testing.dockerComposeFile
    ? "REQUIREMENTS.md"
    : "REQUIREMENTS.md";
  let requirementsContent: string;
  try {
    requirementsContent = fs.readFileSync(requirementsPath, "utf-8");
  } catch {
    return {
      status: "stuck",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
      results: [],
      attemptsUsed: 1,
    };
  }

  // 2. Detect app type
  const appType = detectAppType(config);

  // 3. Extract workflows
  const workflows = extractUserWorkflows(requirementsContent, appType);
  if (workflows.length === 0) {
    return {
      status: "passed",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
      results: [],
      attemptsUsed: 1,
    };
  }

  // 4. Build safety config and prompt
  const safetyConfig: SafetyConfig = {
    useSandboxCredentials: true,
    useLocalSmtp: true,
    useTestDb: true,
    envFile: ".env.test",
  };
  const safetyPrompt = buildSafetyPrompt(safetyConfig);

  // 5. Start application
  const started = await startApplication(config, ctx);
  if (!started) {
    return {
      status: "stuck",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
      results: [],
      attemptsUsed: 1,
    };
  }

  // 6. Wait for health
  const healthy = await waitForHealth("http://localhost:3000/health", 30000, ctx);
  if (!healthy) {
    await stopApplication(config, ctx);
    return {
      status: "stuck",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
      results: [],
      attemptsUsed: 1,
    };
  }

  // 7-10. Execute workflows with retry loop
  const maxRetries = config.maxRetries;
  let attempt = 1;
  let workflowsToTest = workflows;
  let allResults: WorkflowResult[] = [];

  while (attempt <= maxRetries + 1) {
    const currentResults: WorkflowResult[] = [];

    for (const workflow of workflowsToTest) {
      const prompt = buildUATPrompt(workflow, appType, safetyPrompt);

      const stepOpts = {
        prompt,
        verify: async () => {
          const result = verifyUATResults(workflow.id, ".forge", ctx);
          return result.passed;
        },
      };

      const startMs = Date.now();
      try {
        await executeStep(
          `uat-${workflow.id}`,
          stepOpts,
          stepRunnerContext,
          costController,
        );
      } catch (err) {
        // Re-throw budget errors -- they are system-level, not workflow failures
        if (err instanceof BudgetExceededError) {
          await stopApplication(config, ctx);
          throw err;
        }
        // Other step execution errors -- treat as failed workflow
      }
      const durationMs = Date.now() - startMs;

      const result = verifyUATResults(workflow.id, ".forge", ctx);
      result.durationMs = durationMs;
      currentResults.push(result);
    }

    // Merge current results into all results (replace any previous results for same workflow)
    for (const cr of currentResults) {
      const existingIdx = allResults.findIndex(
        (r) => r.workflowId === cr.workflowId,
      );
      if (existingIdx >= 0) {
        allResults[existingIdx] = cr;
      } else {
        allResults.push(cr);
      }
    }

    // Check for failures
    const failedWorkflows = currentResults.filter((r) => !r.passed);

    if (failedWorkflows.length === 0) {
      // All passed
      break;
    }

    if (attempt >= maxRetries + 1) {
      // Max retries exhausted
      break;
    }

    // Run gap closure for failed workflows
    await runUATGapClosure(failedWorkflows, ctx);

    // Retry only the failed workflows
    workflowsToTest = workflows.filter((w) =>
      failedWorkflows.some((f) => f.workflowId === w.id),
    );

    attempt++;
  }

  // 8. Stop application
  await stopApplication(config, ctx);

  // 9. Aggregate results
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;

  let status: UATResult["status"];
  if (failed === 0) {
    status = "passed";
  } else if (attempt > maxRetries) {
    status = "stuck";
  } else {
    status = "failed";
  }

  const uatResult: UATResult = {
    status,
    workflowsTested: allResults.length,
    workflowsPassed: passed,
    workflowsFailed: failed,
    results: allResults,
    attemptsUsed: attempt,
  };

  // 11. Update state with final UAT results
  try {
    await stateManager.update((state) => ({
      ...state,
      uatResults: {
        status: uatResult.status === "stuck" ? "failed" : uatResult.status,
        workflowsTested: uatResult.workflowsTested,
        workflowsPassed: uatResult.workflowsPassed,
        workflowsFailed: uatResult.workflowsFailed,
      },
    }));
  } catch {
    // State update failures are non-critical
  }

  return uatResult;
}
