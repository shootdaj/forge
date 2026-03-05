/**
 * Testing Infrastructure -- Traceability & Methodology
 *
 * Manages TEST_GUIDE.md with requirement-to-test mapping,
 * test pyramid enforcement, and testing methodology injection
 * into target project CLAUDE.md.
 *
 * All filesystem operations use an injectable `fs` parameter for testability.
 *
 * Requirements: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
 */

import * as nodeFs from "node:fs";

/**
 * Minimal filesystem interface for dependency injection.
 */
export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf-8"): string;
  writeFileSync(path: string, content: string): void;
  mkdirSync(path: string, options?: { recursive: boolean }): void;
}

/**
 * A single requirement for the test guide.
 */
export interface Requirement {
  id: string;
  description: string;
}

/**
 * A test-to-requirement mapping entry.
 */
export interface TestMapping {
  reqId: string;
  tier: "unit" | "integration" | "scenario";
  testName: string;
}

/**
 * Parsed row from TEST_GUIDE.md.
 */
export interface TestGuideEntry {
  reqId: string;
  description: string;
  unitTests: string[];
  integrationTests: string[];
  scenarioTests: string[];
}

/**
 * Result of verifying test coverage.
 */
export interface CoverageResult {
  covered: string[];
  uncovered: string[];
  missingTiers: Array<{
    reqId: string;
    missing: ("unit" | "integration" | "scenario")[];
  }>;
}

/**
 * Result of test pyramid enforcement.
 */
export interface PyramidResult {
  passed: boolean;
  violations: string[];
}

/**
 * Config for testing methodology injection.
 */
export interface TestMethodologyConfig {
  testNaming: string;
  tiers: string[];
  requirementPrefix: string;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

const FORGE_TESTING_MARKER_START = "<!-- FORGE:TESTING_METHODOLOGY -->";
const FORGE_TESTING_MARKER_END = "<!-- /FORGE:TESTING_METHODOLOGY -->";

// ---------------------------------------------------------------------------
// 1. createTestGuide
// ---------------------------------------------------------------------------

/**
 * Creates the initial TEST_GUIDE.md with a traceability matrix.
 *
 * One row per requirement. Test columns start empty (TBD).
 */
export function createTestGuide(
  requirements: Requirement[],
  outputPath: string,
  fs: FsLike = nodeFs,
): void {
  const lines: string[] = [
    "# Test Guide -- Requirement Traceability",
    "",
    "| Req ID | Requirement | Unit Tests | Integration Tests | Scenario Tests |",
    "|--------|-------------|------------|-------------------|----------------|",
  ];

  for (const req of requirements) {
    lines.push(
      `| ${req.id} | ${req.description} | TBD | TBD | TBD |`,
    );
  }

  lines.push(""); // trailing newline

  fs.writeFileSync(outputPath, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// 2. updateTestGuide
// ---------------------------------------------------------------------------

/**
 * Updates existing TEST_GUIDE.md by appending test names to the
 * appropriate tier columns for matching requirement IDs.
 *
 * Idempotent: duplicate test names are skipped.
 */
export function updateTestGuide(
  phaseRequirementIds: string[],
  testMappings: TestMapping[],
  guidePath: string,
  fs: FsLike = nodeFs,
): void {
  const content = fs.readFileSync(guidePath, "utf-8");
  const lines = content.split("\n");

  // Find table rows (skip header and separator)
  const updatedLines = lines.map((line) => {
    // Only process table rows (start with |, not header/separator)
    if (!line.startsWith("|")) return line;
    if (line.includes("-----")) return line; // separator
    if (line.includes("Req ID")) return line; // header

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 5) return line;

    const rowReqId = cells[0];

    // Only update rows for the given phase requirement IDs
    if (!phaseRequirementIds.includes(rowReqId)) return line;

    // Get relevant mappings for this requirement
    const mappings = testMappings.filter((m) => m.reqId === rowReqId);
    if (mappings.length === 0) return line;

    // Parse existing tests from each tier column
    const unitTests = parseTestCell(cells[2]);
    const integrationTests = parseTestCell(cells[3]);
    const scenarioTests = parseTestCell(cells[4]);

    // Append new tests (idempotent -- skip duplicates)
    for (const mapping of mappings) {
      const target =
        mapping.tier === "unit"
          ? unitTests
          : mapping.tier === "integration"
            ? integrationTests
            : scenarioTests;

      if (!target.includes(mapping.testName)) {
        target.push(mapping.testName);
      }
    }

    // Rebuild the row
    return `| ${rowReqId} | ${cells[1]} | ${formatTestCell(unitTests)} | ${formatTestCell(integrationTests)} | ${formatTestCell(scenarioTests)} |`;
  });

  fs.writeFileSync(guidePath, updatedLines.join("\n"));
}

// ---------------------------------------------------------------------------
// 3. parseTestGuide
// ---------------------------------------------------------------------------

/**
 * Reads and parses TEST_GUIDE.md into a structured array.
 */
export function parseTestGuide(
  guidePath: string,
  fs: FsLike = nodeFs,
): TestGuideEntry[] {
  const content = fs.readFileSync(guidePath, "utf-8");
  const lines = content.split("\n");
  const entries: TestGuideEntry[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    if (line.includes("-----")) continue; // separator
    if (line.includes("Req ID")) continue; // header

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 5) continue;

    entries.push({
      reqId: cells[0],
      description: cells[1],
      unitTests: parseTestCell(cells[2]),
      integrationTests: parseTestCell(cells[3]),
      scenarioTests: parseTestCell(cells[4]),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 4. verifyTestCoverage
// ---------------------------------------------------------------------------

/**
 * Verifies test coverage by checking that every requirement has at least
 * one test in each tier. Returns gap analysis.
 */
export function verifyTestCoverage(
  guidePath: string,
  fs: FsLike = nodeFs,
): CoverageResult {
  const entries = parseTestGuide(guidePath, fs);
  const covered: string[] = [];
  const uncovered: string[] = [];
  const missingTiers: CoverageResult["missingTiers"] = [];

  for (const entry of entries) {
    const missing: ("unit" | "integration" | "scenario")[] = [];

    if (entry.unitTests.length === 0) missing.push("unit");
    if (entry.integrationTests.length === 0) missing.push("integration");
    if (entry.scenarioTests.length === 0) missing.push("scenario");

    if (missing.length === 0) {
      covered.push(entry.reqId);
    } else {
      uncovered.push(entry.reqId);
      missingTiers.push({ reqId: entry.reqId, missing });
    }
  }

  return { covered, uncovered, missingTiers };
}

// ---------------------------------------------------------------------------
// 5. enforceTestPyramid
// ---------------------------------------------------------------------------

/**
 * Enforces the test pyramid shape and growth requirements.
 *
 * Checks:
 *   (a) unit >= integration >= scenario (pyramid shape)
 *   (b) Each count increased from previous (new code must have tests)
 */
export function enforceTestPyramid(
  currentCounts: { unit: number; integration: number; scenario: number },
  previousCounts: { unit: number; integration: number; scenario: number },
): PyramidResult {
  const violations: string[] = [];

  // (a) Pyramid shape
  if (currentCounts.unit < currentCounts.integration) {
    violations.push(
      `Pyramid violation: unit tests (${currentCounts.unit}) < integration tests (${currentCounts.integration})`,
    );
  }
  if (currentCounts.integration < currentCounts.scenario) {
    violations.push(
      `Pyramid violation: integration tests (${currentCounts.integration}) < scenario tests (${currentCounts.scenario})`,
    );
  }

  // (b) Growth check
  if (currentCounts.unit <= previousCounts.unit) {
    violations.push(
      `Growth violation: unit tests did not increase (${previousCounts.unit} -> ${currentCounts.unit})`,
    );
  }
  if (currentCounts.integration <= previousCounts.integration) {
    violations.push(
      `Growth violation: integration tests did not increase (${previousCounts.integration} -> ${currentCounts.integration})`,
    );
  }
  if (currentCounts.scenario <= previousCounts.scenario) {
    violations.push(
      `Growth violation: scenario tests did not increase (${previousCounts.scenario} -> ${currentCounts.scenario})`,
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

// ---------------------------------------------------------------------------
// 6. injectTestingMethodology
// ---------------------------------------------------------------------------

/**
 * Injects testing methodology into a target project's CLAUDE.md.
 *
 * Idempotent: checks for FORGE:TESTING_METHODOLOGY marker before injecting.
 * If already present, does nothing.
 */
export function injectTestingMethodology(
  claudeMdPath: string,
  config: TestMethodologyConfig,
  fs: FsLike = nodeFs,
): void {
  let content = "";
  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, "utf-8");
  }

  // Check if already injected
  if (content.includes(FORGE_TESTING_MARKER_START)) {
    return; // Idempotent -- already injected
  }

  const block = generateTestingMethodologyBlock(config);

  // Append to file
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(claudeMdPath, content + separator + "\n" + block + "\n");
}

// ---------------------------------------------------------------------------
// 7. generateTestingMethodologyBlock
// ---------------------------------------------------------------------------

/**
 * Pure function returning the markdown string for the testing methodology
 * section, wrapped in FORGE marker comments.
 */
export function generateTestingMethodologyBlock(
  config: TestMethodologyConfig,
): string {
  const tierList = config.tiers
    .map((tier, i) => `${i + 1}. **${tier}**`)
    .join("\n");

  return `${FORGE_TESTING_MARKER_START}

# Testing Requirements (Forge)

## Test Naming

Use semantic names: \`${config.testNaming}\`
- Good: \`TestStepRunner_BudgetExceeded\`, \`TestFullPipelineFlow\`
- Bad: \`TestShouldWork\`, \`Test1\`

## Test Tiers

${tierList}

## Requirement References

Every test should reference its requirement ID using the \`${config.requirementPrefix}\` prefix.
See TEST_GUIDE.md for the full requirement-to-test mapping.

## Test Pyramid

Every requirement must have at least one test at each tier.
Test counts must satisfy: unit >= integration >= scenario.
New code must increase test counts at all tiers.

${FORGE_TESTING_MARKER_END}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a test cell from the markdown table.
 * Returns an array of test names (empty if TBD or empty).
 */
function parseTestCell(cell: string): string[] {
  const trimmed = cell.trim();
  if (trimmed === "TBD" || trimmed === "" || trimmed === "-") {
    return [];
  }
  return trimmed.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Format test names back into a cell value.
 * Returns "TBD" if empty.
 */
function formatTestCell(tests: string[]): string {
  if (tests.length === 0) return "TBD";
  return tests.join(", ");
}
