/**
 * Phase Runner Prompt Builders
 *
 * Pure functions that construct prompts for each substep's SDK call.
 * All prompt builders take string parameters and return string output.
 * They do NOT read files or call the SDK directly.
 *
 * Requirements: PHA-02, PHA-03, PHA-06, PHA-07, PHA-09, PHA-10,
 *               GAP-01, GAP-02
 */

import type { GapDiagnosis } from "./types.js";

/**
 * Build the prompt for context gathering.
 *
 * Instructs the agent to detect gray areas, lock decisions in CONTEXT.md,
 * and capture deferred ideas.
 *
 * Requirement: PHA-02
 *
 * @param phaseNumber - The phase number
 * @param phaseGoal - The goal description for this phase
 * @param roadmapContent - Full ROADMAP.md content for context
 * @returns Prompt string for the context gathering step
 */
export function buildContextPrompt(
  phaseNumber: number,
  phaseGoal: string,
  roadmapContent: string,
  phaseDir?: string,
): string {
  return `You are gathering context for Phase ${phaseNumber} of a software project.

## Phase Goal
${phaseGoal}

## Project Roadmap
${roadmapContent}

## Your Task

Analyze the phase goal and identify:
1. **Gray areas** -- ambiguous requirements that need decisions locked down before planning
2. **Implementation decisions** -- technology choices, patterns, and architectural approach
3. **Deferred ideas** -- things that came up but belong in a later phase

Write a CONTEXT.md file to the EXACT path: \`${phaseDir ?? `.planning/phases/${String(phaseNumber).padStart(2, "0")}-phase-${phaseNumber}`}/CONTEXT.md\`

Use this structure:

\`\`\`markdown
# Phase ${phaseNumber}: [Phase Name] - Context

**Gathered:** [today's date]
**Status:** Ready for planning

<domain>
## Phase Boundary
[Clear description of what this phase does and does not cover]
</domain>

<decisions>
## Implementation Decisions
[All decisions locked down with rationale]
</decisions>

<specifics>
## Specific Ideas
[Concrete implementation specifics]
</specifics>

<deferred>
## Deferred Ideas
[Ideas that belong in later phases]
</deferred>
\`\`\`

Focus on being specific and decisive. Every gray area should get a concrete decision.`;
}

/**
 * Build the prompt for plan creation.
 *
 * Instructs the agent to create PLAN.md following GSD methodology.
 *
 * Requirement: PHA-03
 *
 * @param phaseNumber - The phase number
 * @param contextContent - Content of CONTEXT.md from context gathering
 * @param roadmapContent - Full ROADMAP.md content for context
 * @param requirementIds - Requirement IDs this plan must cover
 * @returns Prompt string for the plan creation step
 */
export function buildPlanPrompt(
  phaseNumber: number,
  contextContent: string,
  roadmapContent: string,
  requirementIds: string[],
  phaseDir?: string,
): string {
  const reqList =
    requirementIds.length > 0
      ? requirementIds.join(", ")
      : "No specific requirement IDs provided";

  return `You are creating an execution plan for Phase ${phaseNumber}.

## Context (from prior analysis)
${contextContent}

## Project Roadmap
${roadmapContent}

## Requirements to Cover
The plan MUST address these requirement IDs: ${reqList}

## Your Task

Create a PLAN.md file at the EXACT path: \`${phaseDir ?? `.planning/phases/${String(phaseNumber).padStart(2, "0")}-phase-${phaseNumber}`}/PLAN.md\`

Follow GSD plan-phase methodology:

1. **Frontmatter** with phase, plan number, type, dependencies, and requirement IDs
2. **Objective** describing what this plan accomplishes
3. **Tasks** ordered by dependency with:
   - Clear task names and descriptions
   - File paths for each task
   - Verification criteria
   - Done conditions
4. **Test tasks** for every new component
5. **Success criteria** for the overall plan
6. **Verification commands** to confirm the plan succeeded

Every requirement ID listed above must be referenced in at least one task.
Task numbering must be sequential starting from 1.`;
}

/**
 * Build the prompt for re-planning after verification failure.
 *
 * Instructs the agent to fix the plan with specific feedback about
 * what requirements are missing or what was wrong.
 *
 * Requirement: PHA-06
 *
 * @param phaseNumber - The phase number
 * @param contextContent - Content of CONTEXT.md
 * @param missingRequirements - Requirement IDs not covered by the plan
 * @param feedback - Specific feedback about what needs fixing
 * @returns Prompt string for the re-planning step
 */
export function buildReplanPrompt(
  phaseNumber: number,
  contextContent: string,
  missingRequirements: string[],
  feedback: string,
  phaseDir?: string,
): string {
  return `You need to revise the PLAN.md for Phase ${phaseNumber}.

## Context
${contextContent}

## Problem with Current Plan
${feedback}

## Missing Requirements
The following requirement IDs are NOT covered by the current plan and MUST be added:
${missingRequirements.map((id) => `- ${id}`).join("\n")}

## Your Task

Read the existing PLAN.md at \`${phaseDir ?? `.planning/phases/${String(phaseNumber).padStart(2, "0")}-phase-${phaseNumber}`}/PLAN.md\` and revise it to:
1. Add tasks that cover ALL missing requirement IDs listed above
2. Ensure each missing requirement has at least one task implementing it
3. Include test tasks for any new components added
4. Maintain sequential task numbering
5. Keep all existing tasks that were correct

Write the updated PLAN.md to the same path.`;
}

/**
 * Build the prompt for plan execution.
 *
 * Instructs the agent to execute the plan. Includes resume logic
 * and optional mock instructions for external services.
 *
 * Requirement: PHA-07
 *
 * @param phaseNumber - The phase number
 * @param planContent - Content of PLAN.md
 * @param contextContent - Content of CONTEXT.md
 * @param mockInstructions - Optional instructions for mocking external services
 * @returns Prompt string for the execution step
 */
export function buildExecutePrompt(
  phaseNumber: number,
  planContent: string,
  contextContent: string,
  mockInstructions?: string,
): string {
  const mockSection = mockInstructions
    ? `\n## Mock Instructions\n\nExternal services should be implemented using the mock pattern:\n${mockInstructions}\n\nFollow the interface/mock/real/factory pattern. Tag mock files with FORGE:MOCK comments.\n`
    : "";

  return `You are executing the plan for Phase ${phaseNumber}.

## Context
${contextContent}

## Plan
${planContent}
${mockSection}
## Instructions

1. **Check existing files and continue from where you left off** -- do not redo completed work
2. Execute each task in order as specified in the plan
3. Follow all implementation details and constraints from the context
4. Write clean, well-documented code
5. Create all files listed in each task's file section
6. Run verification steps after each task if specified
7. Commit atomically after each logical unit of work

If a task is already complete (files exist and pass verification), skip it and move to the next.`;
}

/**
 * Build the prompt for root cause diagnosis of verification failures.
 *
 * Instructs the agent to analyze failures and produce structured output
 * categorizing the root cause.
 *
 * Requirement: GAP-01
 *
 * @param verificationReport - Formatted verification report showing failures
 * @param planContent - Content of PLAN.md for reference
 * @param contextContent - Content of CONTEXT.md for reference
 * @returns Prompt string for the diagnosis step
 */
export function buildDiagnosisPrompt(
  verificationReport: string,
  planContent: string,
  contextContent: string,
): string {
  return `You are diagnosing verification failures for a phase execution.

## Verification Report
${verificationReport}

## Plan That Was Executed
${planContent}

## Context
${contextContent}

## Your Task

Analyze the verification failures and diagnose the root cause. Categorize the failure into exactly ONE of these categories:

- **wrong_approach**: The implementation approach is fundamentally incorrect
- **missing_dependency**: A required dependency, package, or file is missing
- **integration_mismatch**: Components don't integrate correctly (wrong types, mismatched interfaces)
- **requirement_ambiguity**: The requirement was unclear and was implemented incorrectly
- **environment_issue**: Build tools, config, or environment setup is wrong

Provide your diagnosis as structured JSON output with:
- category: one of the five categories above
- description: clear explanation of the root cause
- affectedFiles: list of file paths that need changes
- suggestedFix: specific description of what fix to apply
- retestCommand: command to re-run to verify the fix`;
}

/**
 * Build the prompt for executing a targeted fix based on diagnosis.
 *
 * Creates a focused prompt that only fixes the diagnosed issue,
 * not a full re-execution.
 *
 * Requirement: GAP-02
 *
 * @param diagnosis - The structured root cause diagnosis
 * @param planContent - Content of PLAN.md for reference
 * @returns Prompt string for the targeted fix step
 */
export function buildFixPrompt(
  diagnosis: GapDiagnosis,
  planContent: string,
): string {
  return `You need to fix a specific issue diagnosed after verification.

## Diagnosis
- **Category:** ${diagnosis.category}
- **Description:** ${diagnosis.description}
- **Affected Files:** ${diagnosis.affectedFiles.join(", ")}
- **Suggested Fix:** ${diagnosis.suggestedFix}

## Original Plan (for reference)
${planContent}

## Your Task

Apply ONLY the targeted fix described above. Do NOT re-execute the entire plan.

1. Modify only the affected files listed above
2. Apply the suggested fix
3. After fixing, run: \`${diagnosis.retestCommand}\`
4. Verify the fix resolves the issue

This is a targeted fix -- keep changes minimal and focused.`;
}

/**
 * Build the prompt for filling test coverage gaps.
 *
 * Instructs the agent to add tests for components that lack coverage.
 *
 * Requirement: PHA-10
 *
 * @param planContent - Content of PLAN.md for reference
 * @param missingCoverageComponents - Components that need test coverage
 * @returns Prompt string for the test gap filling step
 */
export function buildTestGapPrompt(
  planContent: string,
  missingCoverageComponents: string[],
): string {
  return `You need to add test coverage for components that are missing tests.

## Plan (for reference)
${planContent}

## Components Missing Test Coverage
${missingCoverageComponents.map((comp) => `- ${comp}`).join("\n")}

## Your Task

For each component listed above, create comprehensive tests:

1. **Unit tests** for all public functions and methods
2. **Integration tests** for any component interactions
3. **Scenario tests** for user-facing workflows

Use the project's existing test framework and naming conventions.
Follow the test naming pattern: Test<Component>_<Behavior>[_<Condition>]

Ensure all new tests pass before finishing.`;
}

/**
 * Build the prompt for generating the phase report.
 *
 * Instructs the agent to create PHASE_REPORT.md summarizing the phase.
 *
 * @param phaseNumber - The phase number
 * @param verificationContent - Content of VERIFICATION.md
 * @param gapsContent - Content of GAPS.md (null if no gaps)
 * @param contextContent - Content of CONTEXT.md
 * @returns Prompt string for the report generation step
 */
export function buildReportPrompt(
  phaseNumber: number,
  verificationContent: string,
  gapsContent: string | null,
  contextContent: string,
  phaseDir?: string,
): string {
  const gapsSection = gapsContent
    ? `\n## Gap Closure History\n${gapsContent}\n`
    : "\nNo gap closure was needed -- all verifiers passed on first run.\n";

  return `You are generating the final report for Phase ${phaseNumber}.

## Context
${contextContent}

## Verification Results
${verificationContent}
${gapsSection}
## Your Task

Create a PHASE_REPORT.md file summarizing this phase's execution:

1. **Phase Goals** -- what was the objective
2. **Implementation Summary** -- what was built
3. **Test Results** -- pass/fail counts, coverage metrics
4. **Issues Encountered** -- problems found during execution and how they were resolved
5. **Gap Closure** -- if gaps were found, what diagnosis and fixes were applied
6. **Budget Used** -- cost tracking for this phase
7. **Files Created/Modified** -- key files touched
8. **Next Steps** -- what the next phase needs to know

Write PHASE_REPORT.md to the EXACT path: \`${phaseDir ?? `.planning/phases/${String(phaseNumber).padStart(2, "0")}-phase-${phaseNumber}`}/PHASE_REPORT.md\``;
}
