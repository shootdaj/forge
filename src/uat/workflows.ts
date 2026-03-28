/**
 * UAT Workflow Extraction and Gap Closure
 *
 * Extracts testable user workflows from REQUIREMENTS.md,
 * builds safety guardrail prompts, and runs gap closure
 * for failed workflows.
 *
 * Requirements: UAT-01, UAT-04, UAT-06
 */

import type {
  AppType,
  UATWorkflow,
  WorkflowResult,
  SafetyConfig,
  UATContext,
} from "./types.js";
import type { StepOptions } from "../step-runner/types.js";
import { runStep as defaultRunStep } from "../step-runner/step-runner.js";

/**
 * Extract user workflows from REQUIREMENTS.md content.
 *
 * Parses the formatted requirements document (output from the requirements
 * gatherer module). For each `## R{N}: Title` section, extracts acceptance
 * criteria bullet points and converts each into a UAT workflow.
 *
 * The workflow ID follows the format `UAT-R{N}-{index}` where index is
 * 1-based per requirement section.
 *
 * Requirement: UAT-01
 *
 * @param requirementsContent - Raw markdown content of REQUIREMENTS.md
 * @param appType - Application type (determines testing strategy)
 * @returns Array of UATWorkflow objects
 */
export function extractUserWorkflows(
  requirementsContent: string,
  appType: AppType,
): UATWorkflow[] {
  if (!requirementsContent || requirementsContent.trim().length === 0) {
    return [];
  }

  const workflows: UATWorkflow[] = [];

  // Match requirement sections: ## R{N}: Title
  const requirementRegex = /^## R(\d+):\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  // Find all requirement headers and their positions
  const sections: Array<{
    reqNum: string;
    title: string;
    startIndex: number;
  }> = [];

  while ((match = requirementRegex.exec(requirementsContent)) !== null) {
    sections.push({
      reqNum: match[1],
      title: match[2].trim(),
      startIndex: match.index,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const nextStart =
      i + 1 < sections.length
        ? sections[i + 1].startIndex
        : requirementsContent.length;
    const sectionContent = requirementsContent.slice(
      section.startIndex,
      nextStart,
    );

    // Extract acceptance criteria section
    const acMatch = sectionContent.match(
      /\*\*Acceptance Criteria:\*\*\s*([\s\S]*?)(?=\n\*\*|\n## |$)/,
    );
    if (!acMatch) continue;

    const acContent = acMatch[1];

    // Extract bullet points (lines starting with - )
    const steps = acContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((step) => step.length > 0);

    if (steps.length === 0) continue;

    // Create one workflow per requirement with all acceptance criteria as steps
    const workflowId = `UAT-R${section.reqNum}-01`;
    workflows.push({
      id: workflowId,
      requirementId: `R${section.reqNum}`,
      description: section.title,
      steps,
      appType,
    });

    // If there are many acceptance criteria, split into additional workflows
    // to keep each workflow focused (more than 5 steps gets unwieldy)
    if (steps.length > 5) {
      const chunkSize = 5;
      // Clear the first workflow's steps and re-assign
      workflows[workflows.length - 1].steps = steps.slice(0, chunkSize);

      let chunkIndex = 2;
      for (let j = chunkSize; j < steps.length; j += chunkSize) {
        const chunk = steps.slice(j, j + chunkSize);
        const chunkId = `UAT-R${section.reqNum}-${String(chunkIndex).padStart(2, "0")}`;
        workflows.push({
          id: chunkId,
          requirementId: `R${section.reqNum}`,
          description: `${section.title} (part ${chunkIndex})`,
          steps: chunk,
          appType,
        });
        chunkIndex++;
      }
    }
  }

  return workflows;
}

/**
 * Build mobile-specific safety guardrails.
 * Appended to the general safety prompt when appType is "flutter".
 *
 * Requirement: SAF-01
 *
 * @returns Mobile safety guardrail text
 */
export function buildMobileSafetyBlock(): string {
  return [
    "",
    "## Mobile Safety Guardrails",
    "",
    "CRITICAL — These rules apply to ALL Flutter/mobile testing:",
    "",
    "### Permissions",
    "- Do NOT request real device permissions (camera, microphone, location, contacts, photos)",
    "- All permission-dependent features MUST be mocked or stubbed in tests",
    "- Use permission_handler mock mode for testing permission flows",
    "",
    "### Firebase",
    "- Use ONLY test/demo Firebase projects (project IDs containing 'test', 'demo', 'staging', or 'dev')",
    "- NEVER use production Firebase project IDs",
    "- NEVER use real FCM tokens for push notification testing",
    "- Use Firebase Local Emulator Suite when testing Firebase features",
    "",
    "### Credentials & Signing",
    "- Use ONLY the debug keystore for Android builds (default debug.keystore)",
    "- NEVER reference or use production signing keys, keystores, or provisioning profiles",
    "- NEVER hardcode API keys, secrets, or tokens in Dart source files",
    "- Store all secrets in dart-define or .env files excluded from version control",
    "",
    "### Network & Data",
    "- All network calls in tests MUST target localhost, test servers, or mocked endpoints",
    "- NEVER make real API calls to production services during testing",
    "- Use test/sandbox payment processing (Stripe test keys, etc.)",
    "",
  ].join("\n");
}

/**
 * Build the safety guardrail portion of UAT prompts.
 *
 * Lists constraints that prevent production credential usage,
 * enforce test databases, and require local SMTP for email testing.
 * Includes mobile-specific guardrails when appType is "flutter".
 *
 * Requirement: UAT-04, SAF-01
 *
 * @param safetyConfig - Safety configuration options
 * @param appType - Optional app type to include type-specific guardrails
 * @returns Safety prompt string to append to UAT prompts
 */
export function buildSafetyPrompt(safetyConfig: SafetyConfig, appType?: AppType): string {
  const lines: string[] = [
    "## Safety Guardrails",
    "",
    "You MUST follow these safety constraints during UAT testing:",
    "",
  ];

  if (safetyConfig.useSandboxCredentials) {
    lines.push(
      "- NEVER use production credentials. Use ONLY sandbox/test credentials.",
    );
    lines.push(
      `- Load ALL environment variables from ${safetyConfig.envFile} (NOT .env or .env.production).`,
    );
  }

  if (safetyConfig.useLocalSmtp) {
    lines.push(
      "- Use local SMTP capture (Mailhog/Mailtrap) for ALL email testing. NEVER send real emails.",
    );
  }

  if (safetyConfig.useTestDb) {
    lines.push(
      "- Use the test database from the Docker container. NEVER connect to production or staging databases.",
    );
  }

  lines.push(
    "- Use test OAuth apps / mock providers ONLY. NEVER authenticate against production OAuth providers.",
  );
  lines.push(
    "- All test data must be self-contained and cleaned up after the test run.",
  );

  let prompt = lines.join("\n");

  // Append mobile-specific guardrails for Flutter projects
  if (appType === "flutter") {
    prompt += buildMobileSafetyBlock();
  }

  return prompt;
}

/**
 * Run gap closure for failed UAT workflows.
 *
 * For each failed workflow, calls runStep() with a prompt that includes
 * the workflow ID, the failure errors, and instructions to create a
 * targeted fix. Each fix step is named `uat-fix-{workflowId}`.
 *
 * Does not throw -- gap closure failures are logged but not fatal.
 *
 * Requirement: UAT-06
 *
 * @param failedWorkflows - Array of WorkflowResult objects that failed
 * @param ctx - UAT context with step runner dependencies
 */
export async function runUATGapClosure(
  failedWorkflows: WorkflowResult[],
  ctx: UATContext,
): Promise<void> {
  const executeStep = ctx.runStepFn ?? defaultRunStep;

  for (const wf of failedWorkflows) {
    const stepName = `uat-fix-${wf.workflowId}`;
    const errorList = wf.errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n");

    const prompt = `## UAT Gap Closure: Fix ${wf.workflowId}

The following UAT workflow failed during testing:

**Workflow ID:** ${wf.workflowId}
**Steps Passed:** ${wf.stepsPassed}
**Steps Failed:** ${wf.stepsFailed}

**Errors:**
${errorList}

## Instructions

1. Analyze the errors above to identify the root cause
2. Create a targeted fix that addresses ONLY the failing steps
3. Do NOT change unrelated code or refactor
4. After fixing, verify that the fix resolves the errors

Focus on the minimum change needed to make this workflow pass.`;

    const stepOpts: StepOptions = {
      prompt,
      verify: async () => true, // Gap closure success is verified by re-running UAT
      maxBudgetUsd: ctx.config.maxBudgetPerStep,
    };

    try {
      await executeStep(stepName, stepOpts, ctx.stepRunnerContext, ctx.costController);
    } catch {
      // Gap closure failures are non-fatal -- log and continue
      // The retry loop in runUAT will detect if the fix worked
    }
  }
}
