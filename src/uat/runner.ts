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
import * as path from "node:path";
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
import { withEmulator } from "./emulator.js";
import { withSimulator } from "./ios-simulator.js";
import { withFlutterRun } from "./flutter-run.js";
import { executeMaestroUAT, maestroResultToWorkflowResults } from "./maestro.js";
import type { EmulatorStartOptions } from "./emulator-types.js";
import type { SimulatorBootOptions } from "./ios-simulator-types.js";

/**
 * Detect the application type from the project configuration.
 *
 * Checks for Flutter projects first (via pubspec.yaml or stack config),
 * then falls back to existing web/api/cli detection.
 *
 * Requirement: UAT-02, DET-01, DET-02
 *
 * @param config - Project configuration
 * @param cwd - Optional project root directory for filesystem-based detection
 * @returns Detected app type
 */
export function detectAppType(config: ForgeConfig, cwd?: string): AppType {
  // Flutter detection: pubspec.yaml in project root (highest priority)
  if (cwd) {
    const pubspecPath = path.resolve(cwd, "pubspec.yaml");
    if (nodeFs.existsSync(pubspecPath)) {
      return "flutter";
    }
  }

  const stack = config.testing.stack.toLowerCase();

  // Explicit Flutter/Dart stack configuration
  if (stack === "flutter" || stack === "dart") {
    return "flutter";
  }

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
    case "flutter":
      lines.push(
        "This is a Flutter mobile app. UAT uses Maestro CLI to test workflows on the Android emulator.",
      );
      lines.push("");
      lines.push("## Widget Identification (CRITICAL)");
      lines.push("");
      lines.push(
        "All interactive Flutter widgets MUST have a `Key(ValueKey('semantic-id'))` for Maestro to find them.",
      );
      lines.push(
        "Use descriptive IDs: `ValueKey('login-email-field')`, `ValueKey('submit-button')`, `ValueKey('todo-item-${index}')`.",
      );
      lines.push(
        "Maestro targets these via the `id` property in flow YAML — NOT by coordinates or text content.",
      );
      lines.push("");
      lines.push("## Maestro Flow Requirements");
      lines.push("");
      lines.push(
        "Write Maestro flow YAML files to the `.maestro/` directory. Each flow should:",
      );
      lines.push(
        "1. Start with `appId:` pointing to the Flutter app's bundle ID",
      );
      lines.push(
        "2. Target widgets by `id:` (semantic identifier) — NEVER by coordinates",
      );
      lines.push(
        "3. Include `- waitForAnimationToEnd` after EVERY navigation action (push, pop, tab switch)",
      );
      lines.push(
        "4. Use `- assertVisible:` with semantic identifiers for verification",
      );
      lines.push(
        "5. Use `- clearState` at the start of each flow for test isolation",
      );
      lines.push("");
      lines.push("## Example Maestro Flow");
      lines.push("");
      lines.push("```yaml");
      lines.push("appId: com.example.myapp");
      lines.push("---");
      lines.push("- clearState");
      lines.push("- launchApp");
      lines.push("- waitForAnimationToEnd");
      lines.push("- tapOn:");
      lines.push('    id: "login-email-field"');
      lines.push("- inputText: \"test@example.com\"");
      lines.push("- tapOn:");
      lines.push('    id: "login-password-field"');
      lines.push("- inputText: \"password123\"");
      lines.push("- tapOn:");
      lines.push('    id: "login-submit-button"');
      lines.push("- waitForAnimationToEnd");
      lines.push("- assertVisible:");
      lines.push('    id: "home-screen"');
      lines.push("```");
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

  // Flutter apps use Maestro UAT, not Docker-based UAT
  if (appType === "flutter") {
    return await runFlutterUAT(ctx);
  }

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

// ---------------------------------------------------------------------------
// Flutter UAT Path
// ---------------------------------------------------------------------------

/**
 * Build the agent prompt for generating Maestro flow YAML files.
 *
 * Instructs the agent to create one flow per workflow with semantic
 * identifiers and animation handling.
 *
 * Requirement: MAE-05, MAE-07
 *
 * @param workflows - User workflows to generate flows for
 * @param safetyPrompt - Safety guardrails text
 * @param flowsDir - Directory for Maestro flow files
 * @returns Agent prompt string
 */
function buildFlutterFlowGenPrompt(
  workflows: UATWorkflow[],
  safetyPrompt: string,
  flowsDir: string,
): string {
  const lines: string[] = [
    "## Generate Maestro UAT Flows",
    "",
    `Write Maestro flow YAML files to the \`${flowsDir}/\` directory.`,
    "Create one flow file per user workflow below.",
    "",
    "## Workflows to Test",
    "",
  ];

  for (const wf of workflows) {
    lines.push(`### ${wf.id}: ${wf.description}`);
    wf.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
    lines.push("");
  }

  lines.push("## Flow Requirements");
  lines.push("");
  lines.push(
    "- Target widgets by `id:` (ValueKey semantic identifier) — NEVER by coordinates or text",
  );
  lines.push(
    "- Include `- waitForAnimationToEnd` after EVERY navigation action",
  );
  lines.push("- Start each flow with `- clearState` for isolation");
  lines.push("- Use `- assertVisible:` with `id:` for verifications");
  lines.push("- Each flow file should be named `flow-{workflowId}.yaml`");
  lines.push("");
  lines.push(safetyPrompt);

  return lines.join("\n");
}

/**
 * Inner Maestro UAT logic shared between Android and iOS paths.
 *
 * Handles: flow generation, Maestro test execution, gap closure loop, result aggregation.
 * Platform-agnostic — accepts a deviceId that works for both Android serial and iOS UDID.
 *
 * Requirements: MAE-01, MAE-02, MAE-05, MAE-06, MAE-07, IOS-03
 *
 * @param deviceId - Android emulator serial or iOS Simulator UDID
 * @param workflows - User workflows to test
 * @param safetyPrompt - Safety guardrails text
 * @param flowsDir - Directory for Maestro flow files
 * @param maxRetries - Maximum retry attempts
 * @param ctx - UAT context with all dependencies
 * @returns Aggregate UAT result
 */
async function runMaestroUATInner(
  deviceId: string,
  workflows: UATWorkflow[],
  safetyPrompt: string,
  flowsDir: string,
  maxRetries: number,
  ctx: UATContext,
): Promise<UATResult> {
  const fs = ctx.fs ?? nodeFs;
  const { stepRunnerContext, costController } = ctx;
  const executeStep = ctx.runStepFn ?? defaultRunStep;

  // Generate Maestro flows via agent step
  const flowGenPrompt = buildFlutterFlowGenPrompt(
    workflows,
    safetyPrompt,
    flowsDir,
  );
  await executeStep(
    "generate-maestro-flows",
    { prompt: flowGenPrompt, verify: async () => true },
    stepRunnerContext,
    costController,
  );

  // Execute Maestro test with retry loop
  let attempt = 1;
  let allResults: WorkflowResult[] = [];

  while (attempt <= maxRetries + 1) {
    const maestroResult = await executeMaestroUAT(
      { flowsDir, serial: deviceId },
      fs as {
        readFileSync: (p: string, enc: string) => string;
        existsSync: (p: string) => boolean;
      },
    );
    const currentResults = maestroResultToWorkflowResults(maestroResult);

    // Merge results
    for (const cr of currentResults) {
      const idx = allResults.findIndex(
        (r) => r.workflowId === cr.workflowId,
      );
      if (idx >= 0) {
        allResults[idx] = cr;
      } else {
        allResults.push(cr);
      }
    }

    const failed = currentResults.filter((r) => !r.passed);
    if (failed.length === 0) break;
    if (attempt >= maxRetries + 1) break;

    // Gap closure for failed flows
    await runUATGapClosure(failed, ctx);
    attempt++;
  }

  // Aggregate results
  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.filter((r) => !r.passed).length;

  let status: UATResult["status"];
  if (failedCount === 0) {
    status = "passed";
  } else if (attempt > maxRetries) {
    status = "stuck";
  } else {
    status = "failed";
  }

  return {
    status,
    workflowsTested: allResults.length,
    workflowsPassed: passedCount,
    workflowsFailed: failedCount,
    results: allResults,
    attemptsUsed: attempt,
  };
}

/**
 * Flutter-specific UAT runner with platform routing.
 *
 * Orchestrates the full Flutter UAT lifecycle:
 * 1. Read requirements
 * 2. Extract workflows
 * 3. Start device: Android emulator (via withEmulator) OR iOS Simulator (via withSimulator)
 * 4. Start Flutter app (via withFlutterRun)
 * 5. Generate Maestro flows (via agent step)
 * 6. Execute Maestro tests
 * 7. Gap closure loop on failures
 * 8. Guaranteed cleanup of flutter run and emulator/simulator
 *
 * Requirements: MAE-01, MAE-02, MAE-03, MAE-04, MAE-05, MAE-06, MAE-07, IOS-01, IOS-03
 *
 * @param ctx - UAT context with all dependencies
 * @returns Aggregate UAT result
 */
export async function runFlutterUAT(ctx: UATContext): Promise<UATResult> {
  const fs = ctx.fs ?? nodeFs;
  const { config, stateManager } = ctx;

  // 1. Read requirements for workflow extraction
  let requirementsContent: string;
  try {
    requirementsContent = fs.readFileSync("REQUIREMENTS.md", "utf-8");
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

  // 2. Extract workflows
  const appType = "flutter" as const;
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

  // 3. Build safety prompt with mobile guardrails
  const safetyConfig: SafetyConfig = {
    useSandboxCredentials: true,
    useLocalSmtp: false,
    useTestDb: false,
    envFile: ".env.test",
  };
  const safetyPrompt = buildSafetyPrompt(safetyConfig, appType);

  const flowsDir = config.testing.maestroFlowsDir || ".maestro";
  const maxRetries = config.maxRetries;

  // 4. Determine platform and run inside device lifecycle with guaranteed cleanup
  const mobilePlatform = config.testing.mobilePlatform || "android";

  try {
    let uatResult: UATResult;

    if (mobilePlatform === "ios") {
      // iOS Simulator path (IOS-01, IOS-03)
      const simulatorOptions: SimulatorBootOptions = {
        deviceName: config.testing.iosSimulatorDevice || undefined,
      };

      uatResult = await withSimulator(
        simulatorOptions,
        async (simulatorHandle) => {
          return await withFlutterRun(
            { serial: simulatorHandle.udid },
            async () => {
              return await runMaestroUATInner(
                simulatorHandle.udid,
                workflows,
                safetyPrompt,
                flowsDir,
                maxRetries,
                ctx,
              );
            },
          );
        },
      );
    } else {
      // Android emulator path (default)
      const avdName = config.testing.flutterAvdName || "Pixel_6_API_33";
      const emulatorOptions: EmulatorStartOptions = { avdName };

      uatResult = await withEmulator(
        emulatorOptions,
        async (emulatorHandle) => {
          return await withFlutterRun(
            { serial: emulatorHandle.serial },
            async () => {
              return await runMaestroUATInner(
                emulatorHandle.serial,
                workflows,
                safetyPrompt,
                flowsDir,
                maxRetries,
                ctx,
              );
            },
          );
        },
      );
    }

    // Update state with UAT results
    try {
      await stateManager.update((state) => ({
        ...state,
        uatResults: {
          status:
            uatResult.status === "stuck" ? "failed" : uatResult.status,
          workflowsTested: uatResult.workflowsTested,
          workflowsPassed: uatResult.workflowsPassed,
          workflowsFailed: uatResult.workflowsFailed,
        },
      }));
    } catch {
      // State update failures are non-critical
    }

    return uatResult;
  } catch (err) {
    // Re-throw budget errors
    if (err instanceof BudgetExceededError) {
      throw err;
    }

    // Other errors (emulator/simulator failure, flutter run failure) → stuck
    return {
      status: "stuck",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
      results: [],
      attemptsUsed: 1,
    };
  }
}
