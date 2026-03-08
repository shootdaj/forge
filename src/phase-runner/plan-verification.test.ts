/**
 * Plan Verification and Test Task Injection Tests
 *
 * Pure function tests -- no filesystem or mocking needed.
 * Uses realistic plan content snippets mimicking GSD PLAN.md format.
 *
 * Requirements: PHA-04, PHA-05, PHA-06
 */

import { describe, it, expect } from "vitest";

import {
  parsePlanRequirements,
  verifyPlanCoverage,
  injectTestTasks,
  detectMissingTestTasks,
} from "./plan-verification.js";

// ---------------------------------------------------------------------------
// Test fixtures: realistic plan content
// ---------------------------------------------------------------------------

const MINIMAL_PLAN = `---
phase: 05-phase-runner
plan: 01
requirements:
  - PHA-04
  - PHA-05
  - PHA-06
---

<objective>
Define all Phase Runner types and implement plan verification.
</objective>

<tasks>

<task type="auto">
  <name>Task 1: Define Phase Runner types</name>
  <files>src/phase-runner/types.ts</files>
  <action>Create type definitions for PHA-04, PHA-05.</action>
  <done>Types compile without errors</done>
</task>

<task type="auto">
  <name>Task 2: Implement plan verification</name>
  <files>src/phase-runner/plan-verification.ts</files>
  <action>Implement verifyPlanCoverage for PHA-06.</action>
  <done>All tests pass</done>
</task>

<task type="auto">
  <name>Task 3: Write tests for plan verification</name>
  <files>src/phase-runner/plan-verification.test.ts</files>
  <action>Write unit tests for plan verification.</action>
  <done>All tests pass</done>
</task>

</tasks>

<verification>
All tests pass.
</verification>

<success_criteria>
- All types defined
- Plan verification works
</success_criteria>
`;

const PLAN_WITHOUT_TESTS = `---
phase: 05-phase-runner
plan: 01
requirements:
  - PHA-04
  - PHA-05
---

<tasks>

<task type="auto">
  <name>Task 1: Define types</name>
  <files>src/phase-runner/types.ts</files>
  <action>Create type definitions for PHA-04 and PHA-05.</action>
  <done>Types compile</done>
</task>

<task type="auto">
  <name>Task 2: Implement verification</name>
  <files>src/phase-runner/plan-verification.ts</files>
  <action>Build verification logic.</action>
  <done>Logic works</done>
</task>

</tasks>
`;

const PLAN_WITH_SCOPE_CREEP = `---
phase: 05-phase-runner
plan: 01
requirements:
  - PHA-04
---

<tasks>

<task type="auto">
  <name>Task 1: Implement PHA-04 and also STEP-01 and COST-02</name>
  <files>src/phase-runner/types.ts</files>
  <action>Create types for PHA-04. Also sneak in STEP-01 and COST-02 changes.</action>
  <done>Done</done>
</task>

<task type="auto">
  <name>Task 2: Write tests</name>
  <files>src/phase-runner/types.test.ts</files>
  <action>Write unit tests.</action>
  <done>Tests pass</done>
</task>

</tasks>

<success_criteria>
All done.
</success_criteria>
`;

const PLAN_WITH_GAPS = `---
phase: 05-phase-runner
plan: 01
---

<tasks>

<task type="auto">
  <name>Task 1: Implement plan verification</name>
  <files>src/phase-runner/plan-verification.ts</files>
  <action>Build plan verification for PHA-04, PHA-05.</action>
  <done>Logic works</done>
</task>

<task type="auto">
  <name>Task 2: Write test for plan verification</name>
  <files>src/phase-runner/plan-verification.test.ts</files>
  <action>Test PHA-04 and PHA-05 coverage.</action>
  <done>Tests pass</done>
</task>

</tasks>

<verification>
Run verification.
</verification>
`;

// ---------------------------------------------------------------------------
// parsePlanRequirements
// ---------------------------------------------------------------------------

describe("parsePlanRequirements", () => {
  it("TestPlanVerification_ParseRequirements_Standard", () => {
    const ids = parsePlanRequirements(MINIMAL_PLAN);

    expect(ids).toContain("PHA-04");
    expect(ids).toContain("PHA-05");
    expect(ids).toContain("PHA-06");
  });

  it("TestPlanVerification_ParseRequirements_CaseInsensitive", () => {
    const content = "This plan covers pha-01 and Pha-02 requirements.";
    const ids = parsePlanRequirements(content);

    expect(ids).toContain("PHA-01");
    expect(ids).toContain("PHA-02");
  });

  it("TestPlanVerification_ParseRequirements_MultipleFormats", () => {
    const content = `
      (PHA-01) is referenced here.
      [PHA-02] is also used.
      PHA-03: is at the start.
      See PHA-04, PHA-05 for more.
    `;
    const ids = parsePlanRequirements(content);

    expect(ids).toEqual(
      expect.arrayContaining(["PHA-01", "PHA-02", "PHA-03", "PHA-04", "PHA-05"]),
    );
    expect(ids.length).toBe(5);
  });

  it("TestPlanVerification_ParseRequirements_ShortFormat", () => {
    const content = `---
requirement_ids: [R1, R14, R15]
---
This plan covers R1 and R14 and R15.
`;
    const ids = parsePlanRequirements(content, ["R1", "R14", "R15"]);

    expect(ids).toContain("R1");
    expect(ids).toContain("R14");
    expect(ids).toContain("R15");
  });

  it("TestPlanVerification_ParseRequirements_KnownIdsLiteralMatch", () => {
    const content = "This plan addresses requirement R21 for internationalization.";
    const ids = parsePlanRequirements(content, ["R21", "R22"]);

    expect(ids).toContain("R21");
    expect(ids).not.toContain("R22");
  });

  it("TestPlanVerification_ParseRequirements_Deduplicates", () => {
    const content = `
      PHA-01 appears here.
      And PHA-01 appears again.
      Even pha-01 in lowercase.
    `;
    const ids = parsePlanRequirements(content);

    expect(ids.filter((id) => id === "PHA-01")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// verifyPlanCoverage
// ---------------------------------------------------------------------------

describe("verifyPlanCoverage", () => {
  it("TestPlanVerification_VerifyCoverage_AllCovered", () => {
    const result = verifyPlanCoverage(MINIMAL_PLAN, [
      "PHA-04",
      "PHA-05",
      "PHA-06",
    ]);

    expect(result.passed).toBe(true);
    expect(result.missingRequirements).toEqual([]);
    expect(result.coveredRequirements).toEqual(
      expect.arrayContaining(["PHA-04", "PHA-05", "PHA-06"]),
    );
  });

  it("TestPlanVerification_VerifyCoverage_MissingRequirements", () => {
    // PLAN_WITH_GAPS only references PHA-04 and PHA-05 in its content.
    // PHA-06, PHA-11, PHA-12 are NOT mentioned anywhere in the plan.
    const result = verifyPlanCoverage(PLAN_WITH_GAPS, [
      "PHA-04",
      "PHA-05",
      "PHA-06",
      "PHA-11",
      "PHA-12",
    ]);

    expect(result.passed).toBe(false);
    expect(result.missingRequirements).toContain("PHA-06");
    expect(result.missingRequirements).toContain("PHA-11");
    expect(result.missingRequirements).toContain("PHA-12");
    expect(result.coveredRequirements).toContain("PHA-04");
    expect(result.coveredRequirements).toContain("PHA-05");
  });

  it("TestPlanVerification_VerifyCoverage_MissingTestTasks", () => {
    const result = verifyPlanCoverage(PLAN_WITHOUT_TESTS, [
      "PHA-04",
      "PHA-05",
    ]);

    // PLAN_WITHOUT_TESTS has no test keywords
    expect(result.passed).toBe(false);
    expect(result.hasTestTasks).toBe(false);
  });

  it("TestPlanVerification_VerifyCoverage_ScopeCreep", () => {
    const result = verifyPlanCoverage(PLAN_WITH_SCOPE_CREEP, ["PHA-04"]);

    expect(result.scopeCreep).toContain("STEP-01");
    expect(result.scopeCreep).toContain("COST-02");
  });

  it("TestPlanVerification_VerifyCoverage_HasSuccessCriteria", () => {
    const result = verifyPlanCoverage(MINIMAL_PLAN, [
      "PHA-04",
      "PHA-05",
      "PHA-06",
    ]);

    expect(result.hasSuccessCriteria).toBe(true);
  });

  it("TestPlanVerification_VerifyCoverage_ExecutionOrder", () => {
    const result = verifyPlanCoverage(MINIMAL_PLAN, [
      "PHA-04",
      "PHA-05",
      "PHA-06",
    ]);

    // Tasks 1, 2, 3 are sequential
    expect(result.executionOrderValid).toBe(true);
  });

  it("TestPlanVerification_VerifyCoverage_ShortIdFormat", () => {
    const content = `---
requirement_ids: [R1, R14, R15, R16]
---

### 1. Project Scaffolding
**Requirements:** R1, R16
Scaffold the project. Write tests.

### 2. Auth Setup
**Requirements:** R14, R15
Set up OAuth. Write tests.

<success_criteria>All done</success_criteria>
`;
    const result = verifyPlanCoverage(content, ["R1", "R14", "R15", "R16"]);

    expect(result.passed).toBe(true);
    expect(result.missingRequirements).toEqual([]);
    expect(result.coveredRequirements).toEqual(
      expect.arrayContaining(["R1", "R14", "R15", "R16"]),
    );
  });

  it("TestPlanVerification_VerifyCoverage_EmptyRequirements_Passes", () => {
    const result = verifyPlanCoverage("Some plan content", []);
    expect(result.passed).toBe(true);
  });

  it("TestPlanVerification_VerifyCoverage_ExecutionOrderInvalid", () => {
    const content = `
<task type="auto">
  <name>Task 1: First</name>
  <files>src/a.ts</files>
  <action>Do PHA-01. Write test.</action>
</task>
<task type="auto">
  <name>Task 3: Third (skipped 2)</name>
  <files>src/b.ts</files>
  <action>Do PHA-02. Write test.</action>
</task>

<success_criteria>Done</success_criteria>
`;
    const result = verifyPlanCoverage(content, ["PHA-01", "PHA-02"]);

    expect(result.executionOrderValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// injectTestTasks
// ---------------------------------------------------------------------------

describe("injectTestTasks", () => {
  it("TestPlanVerification_InjectTestTasks_AppendsSection", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, [
      "checkpoint",
      "plan-verification",
    ]);

    expect(result).toContain("Write tests for checkpoint");
    expect(result).toContain("Write tests for plan-verification");
  });

  it("TestPlanVerification_InjectTestTasks_MarkerPresent", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, ["checkpoint"]);

    expect(result).toContain("<!-- FORGE:INJECTED_TEST_TASKS -->");
  });

  it("TestPlanVerification_InjectTestTasks_PreservesExisting", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, ["checkpoint"]);

    // Original content should still be present
    expect(result).toContain("Task 1: Define types");
    expect(result).toContain("Task 2: Implement verification");
  });

  it("TestPlanVerification_InjectTestTasks_ContinuesNumbering", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, [
      "checkpoint",
      "plan-verification",
    ]);

    // PLAN_WITHOUT_TESTS has Task 1 and Task 2, so injected should be Task 3 and Task 4
    expect(result).toContain("Task 3:");
    expect(result).toContain("Task 4:");
  });

  it("TestPlanVerification_InjectTestTasks_EmptyComponents", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, []);

    // No injection should happen
    expect(result).toBe(PLAN_WITHOUT_TESTS);
  });

  it("TestPlanVerification_InjectTestTasks_BeforeClosingTag", () => {
    const result = injectTestTasks(PLAN_WITHOUT_TESTS, ["checkpoint"]);

    // The injected content should appear before </tasks>
    const markerIndex = result.indexOf("<!-- FORGE:INJECTED_TEST_TASKS -->");
    const closingTagIndex = result.indexOf("</tasks>");

    expect(markerIndex).toBeGreaterThan(-1);
    expect(closingTagIndex).toBeGreaterThan(-1);
    expect(markerIndex).toBeLessThan(closingTagIndex);
  });
});

// ---------------------------------------------------------------------------
// detectMissingTestTasks
// ---------------------------------------------------------------------------

describe("detectMissingTestTasks", () => {
  it("TestPlanVerification_DetectMissingTests_FindsMissing", () => {
    // PLAN_WITHOUT_TESTS has types.ts and plan-verification.ts in <files>
    // but no test references for types (plan-verification has "verification" but not "test")
    const missing = detectMissingTestTasks(PLAN_WITHOUT_TESTS);

    expect(missing).toContain("types");
  });

  it("TestPlanVerification_DetectMissingTests_AllCovered", () => {
    // MINIMAL_PLAN has types.ts, plan-verification.ts, plan-verification.test.ts
    // The test task explicitly references plan-verification tests
    const missing = detectMissingTestTasks(MINIMAL_PLAN);

    // plan-verification has a test file reference, types is referenced in "Define Phase Runner types"
    // which doesn't have a test. So types should be missing.
    expect(missing).toContain("types");
  });

  it("TestPlanVerification_DetectMissingTests_SkipsTestFiles", () => {
    const content = `
<task type="auto">
  <name>Task 1: Create tests</name>
  <files>src/module.test.ts</files>
  <action>Write tests.</action>
</task>
`;
    const missing = detectMissingTestTasks(content);

    // Test files themselves should not be flagged as missing tests
    expect(missing).not.toContain("module.test");
    expect(missing).not.toContain("module");
  });
});
