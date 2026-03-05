/**
 * Plan Verification and Test Task Injection
 *
 * Pure functions for verifying plan coverage against phase requirements,
 * detecting missing test tasks, and injecting test task sections.
 * No side effects, no filesystem operations, no SDK calls.
 *
 * Requirements: PHA-04, PHA-05, PHA-06
 */

import type { PlanVerificationResult } from "./types.js";

/**
 * Extract requirement IDs from plan content.
 *
 * Matches patterns like PHA-01, GAP-03, STEP-01, VER-02, etc.
 * Case-insensitive, deduplicates, returns sorted uppercase array.
 *
 * Requirement: PHA-04
 *
 * @param planContent - The raw plan markdown content
 * @returns Sorted array of unique uppercase requirement IDs
 */
export function parsePlanRequirements(planContent: string): string[] {
  const pattern = /\b([A-Z]+-\d+)\b/gi;
  const ids = new Set<string>();

  for (const match of planContent.matchAll(pattern)) {
    ids.add(match[1].toUpperCase());
  }

  return [...ids].sort();
}

/**
 * Verify a plan's coverage against a set of required requirement IDs.
 *
 * Checks:
 * - All required IDs are referenced in the plan
 * - The plan includes test-related tasks
 * - The plan has success/verification criteria
 * - No scope creep (extra IDs not in required set)
 * - Tasks are numbered sequentially
 *
 * `passed` is true when: no missing requirements AND has test tasks.
 *
 * Requirement: PHA-04
 *
 * @param planContent - The raw plan markdown content
 * @param requiredIds - Requirement IDs this plan should cover
 * @returns Full PlanVerificationResult
 */
export function verifyPlanCoverage(
  planContent: string,
  requiredIds: string[],
): PlanVerificationResult {
  const normalizedRequired = requiredIds.map((id) => id.toUpperCase());
  const allIdsInPlan = parsePlanRequirements(planContent);

  // Covered: IDs in the plan that are also in the required set
  const coveredRequirements = allIdsInPlan.filter((id) =>
    normalizedRequired.includes(id),
  );

  // Missing: required IDs not found in the plan
  const missingRequirements = normalizedRequired.filter(
    (id) => !allIdsInPlan.includes(id),
  );

  // Test task detection: look for test-related keywords in task sections
  const testKeywords =
    /\b(test|tests|testing|unit test|integration test|scenario test)\b/i;
  const hasTestTasks = testKeywords.test(planContent);

  // Missing test tasks: components without test coverage
  const missingTestTasks = detectMissingTestTasks(planContent);

  // Success criteria detection
  const hasSuccessCriteria =
    /\b(success|verification|verify|done|success_criteria|success criteria)\b/i.test(
      planContent,
    );

  // Execution order: check tasks are numbered sequentially
  const executionOrderValid = checkExecutionOrder(planContent);

  // Scope creep: IDs in the plan that are NOT in the required set
  // Filter out common non-requirement prefixes
  const nonRequirementPrefixes = ["TEST", "GEN", "DOC"];
  const scopeCreep = allIdsInPlan.filter(
    (id) =>
      !normalizedRequired.includes(id) &&
      !nonRequirementPrefixes.some((prefix) => id.startsWith(prefix)),
  );

  return {
    passed: missingRequirements.length === 0 && hasTestTasks,
    coveredRequirements,
    missingRequirements,
    hasTestTasks,
    missingTestTasks,
    executionOrderValid,
    hasSuccessCriteria,
    scopeCreep,
  };
}

/**
 * Inject test task sections into a plan for components that lack test tasks.
 *
 * Appends a well-structured test tasks section with:
 * - A `<!-- FORGE:INJECTED_TEST_TASKS -->` marker for traceability
 * - Task numbering continuing from the highest existing task number
 * - Unit, integration, and scenario test requirements per component
 *
 * Requirement: PHA-05
 *
 * @param planContent - The raw plan markdown content
 * @param components - Component names that need test tasks
 * @returns Modified plan content with injected test tasks
 */
export function injectTestTasks(
  planContent: string,
  components: string[],
): string {
  if (components.length === 0) {
    return planContent;
  }

  // Detect highest existing task number
  const taskNumberPattern = /Task\s+(\d+)/gi;
  let maxTaskNumber = 0;
  for (const match of planContent.matchAll(taskNumberPattern)) {
    const num = parseInt(match[1], 10);
    if (num > maxTaskNumber) {
      maxTaskNumber = num;
    }
  }

  // Build the test task section
  const testTaskLines: string[] = [
    "",
    "<!-- FORGE:INJECTED_TEST_TASKS -->",
    "",
  ];

  for (let i = 0; i < components.length; i++) {
    const taskNum = maxTaskNumber + i + 1;
    const comp = components[i];

    testTaskLines.push(`<task type="auto">`);
    testTaskLines.push(
      `  <name>Task ${taskNum}: Write tests for ${comp}</name>`,
    );
    testTaskLines.push(`  <action>`);
    testTaskLines.push(
      `Write comprehensive tests for the ${comp} component:`,
    );
    testTaskLines.push(
      `- Unit tests for all public functions/methods`,
    );
    testTaskLines.push(
      `- Integration tests for any API endpoints or service interactions`,
    );
    testTaskLines.push(`- Scenario tests for user-facing workflows`);
    testTaskLines.push(`  </action>`);
    testTaskLines.push(`  <done>`);
    testTaskLines.push(
      `    - All tests pass, coverage verifier passes`,
    );
    testTaskLines.push(`  </done>`);
    testTaskLines.push(`</task>`);
    testTaskLines.push("");
  }

  const injectedSection = testTaskLines.join("\n");

  // Insert before </tasks> closing tag if present, otherwise append at end
  const closingTagIndex = planContent.lastIndexOf("</tasks>");
  if (closingTagIndex !== -1) {
    return (
      planContent.slice(0, closingTagIndex) +
      injectedSection +
      planContent.slice(closingTagIndex)
    );
  }

  return planContent + injectedSection;
}

/**
 * Detect components/modules mentioned in task file sections that lack
 * corresponding test tasks.
 *
 * Parses `<files>` sections in tasks and checks if there are corresponding
 * test-related tasks for those components.
 *
 * Requirement: PHA-05
 *
 * @param planContent - The raw plan markdown content
 * @returns Array of component names that lack test tasks
 */
export function detectMissingTestTasks(planContent: string): string[] {
  // Extract file paths from <files> sections
  const filesPattern = /<files>(.*?)<\/files>/gi;
  const componentFiles = new Set<string>();

  for (const match of planContent.matchAll(filesPattern)) {
    const fileList = match[1].split(",").map((f) => f.trim());
    for (const file of fileList) {
      // Extract the component/module name from the file path
      // e.g., "src/phase-runner/checkpoint.ts" -> "checkpoint"
      // Skip test files themselves
      if (file && !file.includes(".test.") && !file.includes(".spec.")) {
        const baseName = file.split("/").pop();
        if (baseName) {
          const componentName = baseName.replace(/\.(ts|js|tsx|jsx)$/, "");
          if (componentName) {
            componentFiles.add(componentName);
          }
        }
      }
    }
  }

  // Check which components have corresponding test tasks
  const missing: string[] = [];
  for (const component of componentFiles) {
    // Look for test references for this component
    const testPattern = new RegExp(
      `(test|tests|testing).*${escapeRegex(component)}|${escapeRegex(component)}.*(test|tests|\\.test\\.)`,
      "i",
    );
    if (!testPattern.test(planContent)) {
      missing.push(component);
    }
  }

  return missing.sort();
}

/**
 * Check whether tasks are numbered sequentially.
 *
 * A basic heuristic: extract all task numbers and verify they form
 * a sequential series starting from 1 (or at least are in order).
 *
 * @param planContent - The raw plan markdown content
 * @returns True if tasks are in sequential order
 */
function checkExecutionOrder(planContent: string): boolean {
  const taskNumberPattern = /Task\s+(\d+)/gi;
  const numbers: number[] = [];

  for (const match of planContent.matchAll(taskNumberPattern)) {
    const num = parseInt(match[1], 10);
    // Avoid duplicates (same task number may appear in name and references)
    if (!numbers.includes(num)) {
      numbers.push(num);
    }
  }

  if (numbers.length === 0) {
    return true; // No numbered tasks is vacuously valid
  }

  // Check sequential ordering
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      return false;
    }
  }

  return true;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
