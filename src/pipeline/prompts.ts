/**
 * Pipeline Prompt Builders
 *
 * Pure functions that build prompts for pipeline-level agent steps.
 * Each function takes structured data and returns a prompt string
 * ready for use with runStep().
 *
 * Requirements: PIPE-04, PIPE-07, PIPE-08
 */

import type { ForgeState } from "../state/schema.js";
import type { ServiceDetection } from "./types.js";

/**
 * Build prompt for initializing a new project.
 *
 * Tells the agent to run /gsd:new-project with the requirements document.
 * Produces ROADMAP.md and PROJECT.md.
 *
 * @param requirementsDoc - The full requirements document content
 * @returns Prompt string for the new-project step
 */
export function buildNewProjectPrompt(requirementsDoc: string): string {
  return [
    "Initialize a new project using /gsd:new-project.",
    "",
    "Requirements document:",
    "```",
    requirementsDoc,
    "```",
    "",
    "Instructions:",
    "1. Run /gsd:new-project with the requirements above",
    "2. Produce a ROADMAP.md with phases, dependencies, and requirement IDs",
    "3. Produce a PROJECT.md with project context, key decisions, and architecture notes",
    "4. Ensure every requirement ID from the document appears in at least one phase",
  ].join("\n");
}

/**
 * Build prompt for scaffolding CI, Docker, and observability.
 *
 * References existing roadmap phases from state.
 *
 * @param state - Current Forge state
 * @returns Prompt string for the scaffold step
 */
export function buildScaffoldPrompt(state: ForgeState): string {
  const phaseList = Object.entries(state.phases)
    .map(([num, p]) => `  Phase ${num}: ${p.status}`)
    .join("\n");

  return [
    "Scaffold the project's CI, Docker, and observability infrastructure.",
    "",
    "Current phase status:",
    phaseList || "  (no phases tracked yet)",
    "",
    "Tasks:",
    "1. Set up CI pipeline (GitHub Actions or similar) with lint, typecheck, and test stages",
    "2. Create Dockerfile and docker-compose.yml for local development",
    "3. Add health check endpoint at /health or /healthz",
    "4. Set up structured JSON logging",
    "5. Ensure all CI checks pass before proceeding",
  ].join("\n");
}

/**
 * Build prompt for Wave 2 integration: swapping mocks for real implementations.
 *
 * Lists each service with its mock files and credentials.
 * Tells agent to replace mock implementations with real ones.
 *
 * @param services - Services detected during Wave 1
 * @param credentials - Credentials provided by the user
 * @returns Prompt string for the integration step
 */
export function buildIntegrationPrompt(
  services: ServiceDetection[],
  credentials: Record<string, string>,
): string {
  const serviceBlocks = services.map((svc) => {
    const credStatus = svc.credentialsNeeded.map((key) => {
      const provided = key in credentials;
      return `    ${key}: ${provided ? "provided" : "MISSING"}`;
    });

    return [
      `  Service: ${svc.service}`,
      `  Why: ${svc.why}`,
      `  Phase: ${svc.phase}`,
      svc.signupUrl ? `  Signup: ${svc.signupUrl}` : null,
      `  Credentials:`,
      ...credStatus,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const credNames = Object.keys(credentials);

  return [
    "Replace mock service implementations with real integrations.",
    "",
    "Available credentials: " + (credNames.length > 0 ? credNames.join(", ") : "(none)"),
    "",
    "Services to integrate:",
    serviceBlocks.join("\n\n"),
    "",
    "Instructions:",
    "1. For each service, find the mock implementation (look for FORGE:MOCK tags)",
    "2. Implement the real version using the provided credentials",
    "3. Update the factory to return the real implementation when credentials are available",
    "4. Run integration tests after each swap to verify the real implementation works",
    "5. Remove or update test fixtures that relied on mock behavior",
  ].join("\n");
}

/**
 * Build prompt for addressing a skipped item with user guidance.
 *
 * Provides the skipped item context (prior attempts, errors) and user guidance.
 *
 * @param item - The skipped item with attempt history
 * @param guidance - User-provided guidance text for this requirement
 * @returns Prompt string for the skipped item step
 */
export function buildSkippedItemPrompt(
  item: {
    requirement: string;
    phase: number;
    attempts: Array<{ approach: string; error: string }>;
    codeSoFar?: string;
  },
  guidance: string,
): string {
  const attemptBlocks = item.attempts.map(
    (a, i) =>
      `  Attempt ${i + 1}: ${a.approach}\n    Error: ${a.error}`,
  );

  const parts: string[] = [
    `Address skipped requirement: ${item.requirement} (phase ${item.phase})`,
    "",
    "Prior attempts:",
    attemptBlocks.length > 0 ? attemptBlocks.join("\n") : "  (no prior attempts)",
  ];

  if (item.codeSoFar) {
    parts.push("", "Existing partial code:", "```", item.codeSoFar, "```");
  }

  parts.push(
    "",
    "User guidance:",
    guidance,
    "",
    "Instructions:",
    "1. Review the prior attempts and understand what went wrong",
    "2. Follow the user's guidance to implement this requirement",
    "3. Write tests for the implementation",
    "4. Verify the implementation works end-to-end",
  );

  return parts.join("\n");
}

/**
 * Build prompt for fixing a spec compliance gap.
 *
 * For Wave 3+: tells agent to fix a specific requirement gap.
 * Includes round number for context.
 *
 * @param requirementId - The requirement ID that has a gap
 * @param gapDescription - Description of what is missing or failing
 * @param round - Current compliance round number
 * @returns Prompt string for the gap closure step
 */
export function buildComplianceGapPrompt(
  requirementId: string,
  gapDescription: string,
  round: number,
): string {
  return [
    `Fix spec compliance gap for requirement ${requirementId} (round ${round}).`,
    "",
    "Gap description:",
    gapDescription,
    "",
    "Instructions:",
    "1. Analyze the gap description to understand what is missing or broken",
    "2. Make targeted code changes to close this specific gap",
    "3. Run relevant tests to verify the fix",
    "4. Do NOT make unrelated changes -- focus only on this requirement",
    `5. This is compliance round ${round} -- if prior rounds failed to fix this, try a different approach`,
  ].join("\n");
}

/**
 * Build prompt for fixing ALL spec compliance gaps in a single session.
 *
 * Batches all gap fixes into one agent session to avoid the overhead
 * of spawning separate sessions per requirement.
 *
 * @param gaps - Array of { id, description } for each gap
 * @param round - Current compliance round number
 * @param requirementsDoc - Full REQUIREMENTS.md content for context
 * @returns Prompt string for the batch gap fix step
 */
export function buildBatchGapFixPrompt(
  gaps: Array<{ id: string; description: string }>,
  round: number,
  requirementsDoc?: string,
): string {
  const gapList = gaps
    .map((g) => `### ${g.id}\n${g.description}`)
    .join("\n\n");

  const requirementsSection = requirementsDoc
    ? [
        "",
        "## Full Requirements Document",
        "Reference this to understand the full scope of each requirement:",
        "",
        "```markdown",
        requirementsDoc,
        "```",
        "",
      ].join("\n")
    : "";

  return [
    `Fix ALL spec compliance gaps below (round ${round}). There are ${gaps.length} gaps to fix.`,
    requirementsSection,
    "## Gaps to fix:",
    "",
    gapList,
    "",
    "## Instructions:",
    "1. Read the REQUIREMENTS document above to understand the FULL scope of each requirement",
    "2. Work through each gap systematically",
    "3. For each gap: analyze what's missing, implement the fix, write/update tests",
    "4. Run the test suite periodically to verify fixes don't break other things",
    "5. Focus on the most impactful gaps first (core functionality before edge cases)",
    `6. This is compliance round ${round} -- if prior rounds failed to fix a gap, try a DIFFERENT approach`,
    "7. After fixing all gaps, run the full test suite to verify everything passes",
    "8. Do NOT skip any gaps — every gap must be addressed",
  ].join("\n");
}

/**
 * Build prompt for fixing a SINGLE spec compliance gap in a targeted session.
 *
 * Used when batch fixes stall — gives the agent full focus on one requirement.
 *
 * @param requirementId - The requirement ID to fix
 * @param gapDescription - Description of what's missing
 * @param round - Current compliance round number
 * @param requirementsDoc - Full REQUIREMENTS.md content for context
 * @returns Prompt string for the targeted gap fix step
 */
export function buildTargetedGapFixPrompt(
  requirementId: string,
  gapDescription: string,
  round: number,
  requirementsDoc?: string,
): string {
  const requirementsSection = requirementsDoc
    ? [
        "",
        "## Requirements Document",
        `Find requirement ${requirementId} in the document below to understand its FULL scope:`,
        "",
        "```markdown",
        requirementsDoc,
        "```",
        "",
      ].join("\n")
    : "";

  return [
    `TARGETED FIX: Implement requirement ${requirementId} completely (round ${round}).`,
    "",
    "## Gap Description:",
    gapDescription,
    requirementsSection,
    "## Instructions:",
    `1. Find requirement ${requirementId} in the requirements document above and read its FULL description`,
    "2. Search the codebase for any existing partial implementation",
    "3. Implement the requirement COMPLETELY — not partially, not superficially",
    "4. Write comprehensive tests that verify the requirement works end-to-end",
    "5. Run tests to ensure nothing is broken",
    `6. This is round ${round} — previous batch fixes failed to address this. Take a FRESH approach.`,
    "7. If the requirement involves UI, make sure the UI actually renders and is interactive",
    "8. If the requirement involves data, make sure data flows correctly from input to storage to display",
  ].join("\n");
}
