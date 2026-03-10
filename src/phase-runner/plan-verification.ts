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
 * Extract requirement IDs referenced in plan content.
 *
 * Uses two strategies:
 * 1. Frontmatter: parses `requirement_ids:` YAML field (most reliable)
 * 2. Body text: searches for each known required ID as a literal match
 *
 * If knownIds are provided, only those IDs are searched for (no guessing).
 * If no knownIds, falls back to regex pattern matching.
 *
 * Requirement: PHA-04
 */
export function parsePlanRequirements(
  planContent: string,
  knownIds?: string[],
): string[] {
  const ids = new Set<string>();

  // Strategy 1: Parse frontmatter requirement_ids field
  // Matches: requirement_ids: [R1, R14, PHA-01] or requirement_ids: [R1, R14]
  const frontmatterMatch = planContent.match(
    /requirement_ids:\s*\[([^\]]*)\]/i,
  );
  if (frontmatterMatch) {
    const raw = frontmatterMatch[1];
    for (const id of raw.split(",")) {
      const trimmed = id.trim().replace(/['"]/g, "");
      if (trimmed) ids.add(trimmed.toUpperCase());
    }
  }

  // Strategy 2: If known IDs provided, check for each as literal text
  if (knownIds && knownIds.length > 0) {
    const upperContent = planContent.toUpperCase();
    for (const id of knownIds) {
      if (upperContent.includes(id.toUpperCase())) {
        ids.add(id.toUpperCase());
      }
    }
  }

  // Strategy 3: Fallback regex for unknown ID formats
  if (!knownIds || knownIds.length === 0) {
    // Hyphenated: PHA-01, SDK-02
    const hyphenated = /\b([A-Z]{2,}-\d+)\b/gi;
    for (const match of planContent.matchAll(hyphenated)) {
      ids.add(match[1].toUpperCase());
    }
  }

  return [...ids].sort();
}

/**
 * Verify a plan's coverage against a set of required requirement IDs.
 *
 * Checks each required ID against:
 * 1. The plan's frontmatter requirement_ids field
 * 2. Literal presence in the plan body text
 *
 * `passed` is true when: no missing requirements AND has test tasks.
 *
 * Requirement: PHA-04
 */
export function verifyPlanCoverage(
  planContent: string,
  requiredIds: string[],
): PlanVerificationResult {
  // If no requirements specified, pass automatically
  if (requiredIds.length === 0) {
    return {
      passed: true,
      coveredRequirements: [],
      missingRequirements: [],
      hasTestTasks: true,
      missingTestTasks: [],
      executionOrderValid: checkExecutionOrder(planContent),
      hasSuccessCriteria: true,
      scopeCreep: [],
    };
  }

  const normalizedRequired = requiredIds.map((id) => id.toUpperCase());
  const allIdsInPlan = parsePlanRequirements(planContent, requiredIds);

  // Covered: required IDs found in the plan
  const coveredRequirements = normalizedRequired.filter((id) =>
    allIdsInPlan.includes(id),
  );

  // Missing: required IDs not found in the plan
  const missingRequirements = normalizedRequired.filter(
    (id) => !allIdsInPlan.includes(id),
  );

  // Test task detection
  const testKeywords =
    /\b(test|tests|testing|unit test|integration test|scenario test)\b/i;
  const hasTestTasks = testKeywords.test(planContent);

  const missingTestTasks = detectMissingTestTasks(planContent);

  const hasSuccessCriteria =
    /\b(success|verification|verify|done|success_criteria|success criteria)\b/i.test(
      planContent,
    );

  const executionOrderValid = checkExecutionOrder(planContent);

  // Scope creep: IDs found in plan but not in required set
  // Only check IDs from frontmatter (not body text matches)
  const frontmatterIds = parsePlanRequirements(planContent);
  const scopeCreep = frontmatterIds.filter(
    (id) => !normalizedRequired.includes(id),
  );

  return {
    passed: missingRequirements.length === 0,
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
 * Requirement: PHA-05
 */
export function injectTestTasks(
  planContent: string,
  components: string[],
): string {
  if (components.length === 0) {
    return planContent;
  }

  const taskNumberPattern = /Task\s+(\d+)/gi;
  let maxTaskNumber = 0;
  for (const match of planContent.matchAll(taskNumberPattern)) {
    const num = parseInt(match[1], 10);
    if (num > maxTaskNumber) {
      maxTaskNumber = num;
    }
  }

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
 * Requirement: PHA-05
 */
export function detectMissingTestTasks(planContent: string): string[] {
  const filesPattern = /<files>(.*?)<\/files>/gi;
  const componentFiles = new Set<string>();

  for (const match of planContent.matchAll(filesPattern)) {
    const fileList = match[1].split(",").map((f) => f.trim());
    for (const file of fileList) {
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

  const missing: string[] = [];
  for (const component of componentFiles) {
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
 */
function checkExecutionOrder(planContent: string): boolean {
  const taskNumberPattern = /Task\s+(\d+)/gi;
  const numbers: number[] = [];

  for (const match of planContent.matchAll(taskNumberPattern)) {
    const num = parseInt(match[1], 10);
    if (!numbers.includes(num)) {
      numbers.push(num);
    }
  }

  if (numbers.length === 0) {
    return true;
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      return false;
    }
  }

  return true;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
