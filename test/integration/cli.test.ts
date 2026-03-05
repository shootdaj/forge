/**
 * Integration tests for Phase 7: CLI + Git + Testing Infrastructure
 *
 * Requirement coverage:
 * CLI-01: forge init command wiring
 * CLI-02: forge run command wiring
 * CLI-03: forge phase command wiring
 * CLI-04: forge status display integration
 * CLI-05: forge resume with env/guidance loading
 * COST-05: budget breakdown in status display
 * GIT-01: atomic commits with requirement IDs
 * GIT-02: branch protection and phase branches
 * GIT-03: phase branch lifecycle (create -> commit -> merge)
 * TEST-01: testing methodology injection
 * TEST-02: TEST_GUIDE.md creation with mapping
 * TEST-03: TEST_GUIDE.md update after phase
 * TEST-04: requirement-to-test coverage verification
 * TEST-05: test pyramid enforcement
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  getCurrentBranch,
  createPhaseBranch,
  commitWithReqId,
  mergePhaseBranch,
  branchExists,
} from "../../src/cli/git.js";

import {
  createTestGuide,
  updateTestGuide,
  parseTestGuide,
  verifyTestCoverage,
  enforceTestPyramid,
  injectTestingMethodology,
  type FsLike,
  type Requirement,
  type TestMapping,
  type TestMethodologyConfig,
} from "../../src/cli/traceability.js";

import {
  formatStatus,
  formatPhaseTable,
  formatBudgetBreakdown,
} from "../../src/cli/status.js";

import type { ForgeState } from "../../src/state/schema.js";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/** Helper: run a git command in the temp dir */
function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

/** Create an in-memory filesystem for traceability tests */
function createMemoryFs(): FsLike & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    existsSync(p: string): boolean {
      return files.has(p);
    },
    readFileSync(p: string, _encoding: "utf-8"): string {
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      }
      return content;
    },
    writeFileSync(p: string, content: string): void {
      files.set(p, content);
    },
    mkdirSync(_p: string, _options?: { recursive: boolean }): void {
      // no-op
    },
  };
}

/** Factory for a complete ForgeState */
function createTestState(overrides?: Partial<ForgeState>): ForgeState {
  return {
    projectDir: "/test/project",
    startedAt: "2026-01-01T00:00:00Z",
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "wave_1",
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {
      "1": { status: "completed", attempts: 1, budgetUsed: 5.0 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 3.2 },
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
    },
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 12,
      verified: 8,
      gapHistory: [4, 2],
      roundsCompleted: 2,
    },
    remainingGaps: ["R9", "R10", "R11", "R12"],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 8.2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Git workflow integration (GIT-01, GIT-02, GIT-03)
// ---------------------------------------------------------------------------

describe("Git workflow integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-git-integ-"));
    git("git init -b main", tmpDir);
    git('git config user.email "test@forge.dev"', tmpDir);
    git('git config user.name "Forge Test"', tmpDir);
    git("git commit --allow-empty -m 'init'", tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("TestGitWorkflow_FullPhaseLifecycle: create branch -> multi-commit -> merge to main", () => {
    // Step 1: Create phase branch
    createPhaseBranch(3, { cwd: tmpDir });
    expect(getCurrentBranch({ cwd: tmpDir })).toBe("phase-3");

    // Step 2: First commit with req IDs
    fs.writeFileSync(path.join(tmpDir, "auth.ts"), "export const auth = {};");
    const hash1 = commitWithReqId(["R1", "R2"], "add auth module", ["auth.ts"], 3, { cwd: tmpDir });
    expect(hash1).toMatch(/^[0-9a-f]{40}$/);

    // Step 3: Second commit with different req ID
    fs.writeFileSync(path.join(tmpDir, "db.ts"), "export const db = {};");
    const hash2 = commitWithReqId(["R3"], "add database module", ["db.ts"], 3, { cwd: tmpDir });
    expect(hash2).toMatch(/^[0-9a-f]{40}$/);
    expect(hash2).not.toBe(hash1);

    // Step 4: Merge back to main
    mergePhaseBranch(3, { cwd: tmpDir });

    // Verify: on main now
    expect(getCurrentBranch({ cwd: tmpDir })).toBe("main");

    // Verify: phase branch deleted
    expect(branchExists("phase-3", { cwd: tmpDir })).toBe(false);

    // Verify: merge commit exists on main
    const log = git("git log --oneline", tmpDir);
    expect(log).toContain("merge: phase 3 verified");

    // Verify: both feature commits accessible from main
    expect(log).toContain("feat(R1,R2): add auth module");
    expect(log).toContain("feat(R3): add database module");

    // Verify: files exist on main
    expect(fs.existsSync(path.join(tmpDir, "auth.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "db.ts"))).toBe(true);
  });

  it("TestGitWorkflow_CommitWithReqIdProducesParseableFormat", () => {
    createPhaseBranch(5, { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "api.ts"), "export const api = {};");
    commitWithReqId(["R1"], "implement api endpoints", ["api.ts"], 5, { cwd: tmpDir });

    // Use git log --grep to find the commit by requirement ID prefix
    const grepResult = git('git log --grep="feat(R1)" --oneline', tmpDir);
    expect(grepResult).toContain("feat(R1): implement api endpoints");

    // Verify body is also grep-able
    const bodyGrep = git('git log --grep="Requirement: R1" --oneline', tmpDir);
    expect(bodyGrep.length).toBeGreaterThan(0);
  });

  it("TestGitWorkflow_BranchDeletedAfterMerge", () => {
    createPhaseBranch(7, { cwd: tmpDir });
    expect(branchExists("phase-7", { cwd: tmpDir })).toBe(true);

    fs.writeFileSync(path.join(tmpDir, "feature.ts"), "export {};");
    commitWithReqId(["GIT-01"], "add feature", ["feature.ts"], 7, { cwd: tmpDir });

    mergePhaseBranch(7, { cwd: tmpDir });

    // Branch must not exist after merge
    expect(branchExists("phase-7", { cwd: tmpDir })).toBe(false);
  });

  it("TestGitWorkflow_MergeWithoutBranchThrowsDescriptiveError", () => {
    // No phase-99 branch exists -- should throw
    expect(() => mergePhaseBranch(99, { cwd: tmpDir })).toThrow(/Git command failed/);
  });

  it("TestGitWorkflow_MultipleReqIdsInGitLog", () => {
    createPhaseBranch(2, { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "multi.ts"), "export {};");
    commitWithReqId(["CLI-01", "CLI-02", "CLI-03"], "add multi-req feature", ["multi.ts"], 2, { cwd: tmpDir });

    mergePhaseBranch(2, { cwd: tmpDir });

    // Verify all req IDs in a single grep
    const log = git("git log --oneline", tmpDir);
    expect(log).toContain("feat(CLI-01,CLI-02,CLI-03)");
  });
});

// ---------------------------------------------------------------------------
// TEST_GUIDE.md lifecycle integration (TEST-02, TEST-03, TEST-04)
// ---------------------------------------------------------------------------

describe("TEST_GUIDE.md lifecycle integration", () => {
  const GUIDE_PATH = "/project/TEST_GUIDE.md";

  it("TestTestGuideLifecycle_FullCreateUpdateVerifyCycle", () => {
    const memFs = createMemoryFs();

    // Step 1: Create guide with 5 requirements
    const reqs: Requirement[] = [
      { id: "R1", description: "User Registration" },
      { id: "R2", description: "User Login" },
      { id: "R3", description: "Password Reset" },
      { id: "R4", description: "Profile Update" },
      { id: "R5", description: "Account Deletion" },
    ];
    createTestGuide(reqs, GUIDE_PATH, memFs);

    // Step 2: Add unit tests for R1, R2
    updateTestGuide(
      ["R1", "R2"],
      [
        { reqId: "R1", tier: "unit", testName: "TestHashPassword" },
        { reqId: "R2", tier: "unit", testName: "TestValidateLogin" },
      ],
      GUIDE_PATH,
      memFs,
    );

    // Step 3: Add integration tests for R1, R2
    updateTestGuide(
      ["R1", "R2"],
      [
        { reqId: "R1", tier: "integration", testName: "TestRegistrationFlow" },
        { reqId: "R2", tier: "integration", testName: "TestLoginEndpoint" },
      ],
      GUIDE_PATH,
      memFs,
    );

    // Step 4: Add scenario test for R1 only
    updateTestGuide(
      ["R1"],
      [{ reqId: "R1", tier: "scenario", testName: "TestFullRegistrationScenario" }],
      GUIDE_PATH,
      memFs,
    );

    // Step 5: Parse and verify
    const entries = parseTestGuide(GUIDE_PATH, memFs);
    expect(entries).toHaveLength(5);

    const r1 = entries.find((e) => e.reqId === "R1")!;
    expect(r1.unitTests).toEqual(["TestHashPassword"]);
    expect(r1.integrationTests).toEqual(["TestRegistrationFlow"]);
    expect(r1.scenarioTests).toEqual(["TestFullRegistrationScenario"]);

    const r2 = entries.find((e) => e.reqId === "R2")!;
    expect(r2.unitTests).toEqual(["TestValidateLogin"]);
    expect(r2.integrationTests).toEqual(["TestLoginEndpoint"]);
    expect(r2.scenarioTests).toEqual([]); // Missing scenario

    // Step 6: Verify coverage
    const coverage = verifyTestCoverage(GUIDE_PATH, memFs);
    expect(coverage.covered).toEqual(["R1"]); // Only R1 fully covered
    expect(coverage.uncovered).toContain("R2"); // R2 missing scenario
    expect(coverage.uncovered).toContain("R3"); // R3 uncovered
    expect(coverage.uncovered).toContain("R4"); // R4 uncovered
    expect(coverage.uncovered).toContain("R5"); // R5 uncovered

    // R2 specifically missing scenario
    const r2Missing = coverage.missingTiers.find((m) => m.reqId === "R2")!;
    expect(r2Missing.missing).toEqual(["scenario"]);

    // R3-R5 missing all tiers
    const r3Missing = coverage.missingTiers.find((m) => m.reqId === "R3")!;
    expect(r3Missing.missing).toEqual(["unit", "integration", "scenario"]);
  });

  it("TestTestGuideLifecycle_AccumulatesAcrossMultiplePhaseUpdates", () => {
    const memFs = createMemoryFs();

    createTestGuide(
      [
        { id: "R1", description: "Feature A" },
        { id: "R2", description: "Feature B" },
      ],
      GUIDE_PATH,
      memFs,
    );

    // Phase 1 updates
    updateTestGuide(
      ["R1"],
      [{ reqId: "R1", tier: "unit", testName: "TestA_Unit1" }],
      GUIDE_PATH,
      memFs,
    );

    // Phase 2 updates -- adds more tests to R1 and starts R2
    updateTestGuide(
      ["R1", "R2"],
      [
        { reqId: "R1", tier: "unit", testName: "TestA_Unit2" },
        { reqId: "R2", tier: "unit", testName: "TestB_Unit1" },
      ],
      GUIDE_PATH,
      memFs,
    );

    const entries = parseTestGuide(GUIDE_PATH, memFs);
    const r1 = entries.find((e) => e.reqId === "R1")!;
    expect(r1.unitTests).toEqual(["TestA_Unit1", "TestA_Unit2"]); // Accumulated

    const r2 = entries.find((e) => e.reqId === "R2")!;
    expect(r2.unitTests).toEqual(["TestB_Unit1"]);
  });

  it("TestTestGuideLifecycle_VerifyCoverageReportsCorrectMissingTiers", () => {
    const memFs = createMemoryFs();

    createTestGuide(
      [
        { id: "R1", description: "Feature A" },
        { id: "R2", description: "Feature B" },
      ],
      GUIDE_PATH,
      memFs,
    );

    // R1: unit + integration (missing scenario)
    updateTestGuide(
      ["R1"],
      [
        { reqId: "R1", tier: "unit", testName: "U1" },
        { reqId: "R1", tier: "integration", testName: "I1" },
      ],
      GUIDE_PATH,
      memFs,
    );

    // R2: unit only (missing integration + scenario)
    updateTestGuide(
      ["R2"],
      [{ reqId: "R2", tier: "unit", testName: "U2" }],
      GUIDE_PATH,
      memFs,
    );

    const coverage = verifyTestCoverage(GUIDE_PATH, memFs);
    expect(coverage.covered).toEqual([]);
    expect(coverage.uncovered).toEqual(["R1", "R2"]);

    const r1Missing = coverage.missingTiers.find((m) => m.reqId === "R1")!;
    expect(r1Missing.missing).toEqual(["scenario"]);

    const r2Missing = coverage.missingTiers.find((m) => m.reqId === "R2")!;
    expect(r2Missing.missing).toEqual(["integration", "scenario"]);
  });
});

// ---------------------------------------------------------------------------
// Testing methodology injection integration (TEST-01)
// ---------------------------------------------------------------------------

describe("Testing methodology injection integration", () => {
  const CLAUDE_PATH = "/project/CLAUDE.md";

  const config: TestMethodologyConfig = {
    testNaming: "Test<Component>_<Behavior>[_<Condition>]",
    tiers: ["Unit tests", "Integration tests", "Scenario tests"],
    requirementPrefix: "REQ-",
  };

  it("TestMethodologyInjection_EmptyClaudeMdProducesValidMarkdown", () => {
    const memFs = createMemoryFs();

    injectTestingMethodology(CLAUDE_PATH, config, memFs);

    const content = memFs.files.get(CLAUDE_PATH)!;
    expect(content).toContain("<!-- FORGE:TESTING_METHODOLOGY -->");
    expect(content).toContain("<!-- /FORGE:TESTING_METHODOLOGY -->");
    expect(content).toContain("# Testing Requirements (Forge)");
    expect(content).toContain("Test<Component>_<Behavior>[_<Condition>]");
    expect(content).toContain("REQ-");
    expect(content).toContain("unit >= integration >= scenario");
  });

  it("TestMethodologyInjection_PreservesExistingContent", () => {
    const memFs = createMemoryFs();
    memFs.writeFileSync(CLAUDE_PATH, "# My Project\n\nImportant existing content.\n");

    injectTestingMethodology(CLAUDE_PATH, config, memFs);

    const content = memFs.files.get(CLAUDE_PATH)!;
    expect(content).toContain("# My Project");
    expect(content).toContain("Important existing content.");
    expect(content).toContain("<!-- FORGE:TESTING_METHODOLOGY -->");
  });

  it("TestMethodologyInjection_DoubleInjectionIsIdempotent", () => {
    const memFs = createMemoryFs();
    memFs.writeFileSync(CLAUDE_PATH, "# Project\n");

    injectTestingMethodology(CLAUDE_PATH, config, memFs);
    const afterFirst = memFs.files.get(CLAUDE_PATH)!;

    injectTestingMethodology(CLAUDE_PATH, config, memFs);
    const afterSecond = memFs.files.get(CLAUDE_PATH)!;

    expect(afterFirst).toBe(afterSecond);
  });
});

// ---------------------------------------------------------------------------
// Status display integration (CLI-04, COST-05)
// ---------------------------------------------------------------------------

describe("Status display integration", () => {
  it("TestStatusDisplay_FullyPopulatedStateShowsAllSections", () => {
    const state = createTestState({
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payment processing",
          credentialsNeeded: ["STRIPE_SECRET_KEY"],
          mockedIn: [],
        },
      ],
      skippedItems: [
        {
          requirement: "R7",
          phase: 3,
          attempts: [{ approach: "websocket", error: "failed" }],
        },
      ],
    });

    const output = formatStatus(state, 200);

    // All section headers present
    expect(output).toContain("FORGE -- Project Status");
    expect(output).toContain("Phase Progress:");
    expect(output).toContain("Services Needed:");
    expect(output).toContain("Skipped Items:");
    expect(output).toContain("Spec Compliance:");
    expect(output).toContain("Budget:");
  });

  it("TestStatusDisplay_MinimalStateOmitsOptionalSections", () => {
    const state = createTestState({
      servicesNeeded: [],
      skippedItems: [],
    });

    const output = formatStatus(state, 200);

    expect(output).toContain("FORGE -- Project Status");
    expect(output).toContain("Phase Progress:");
    expect(output).not.toContain("Services Needed:");
    expect(output).not.toContain("Skipped Items:");
    expect(output).toContain("Spec Compliance:");
    expect(output).toContain("Budget:");
  });

  it("TestStatusDisplay_BudgetBreakdownShowsCorrectTotals", () => {
    const state = createTestState({
      phases: {
        "1": { status: "completed", attempts: 1, budgetUsed: 10.0 },
        "2": { status: "completed", attempts: 2, budgetUsed: 25.5 },
        "3": { status: "in_progress", attempts: 1, budgetUsed: 5.0 },
      },
      totalBudgetUsed: 40.5,
    });

    const output = formatBudgetBreakdown(state.phases, state.totalBudgetUsed, 200);

    expect(output).toContain("$10.00");
    expect(output).toContain("$25.50");
    expect(output).toContain("$5.00");
    expect(output).toContain("$40.50 / $200.00");
  });

  it("TestStatusDisplay_PhaseTableSortsNumerically", () => {
    const phases: ForgeState["phases"] = {
      "10": { status: "pending", attempts: 0, budgetUsed: 0 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1 },
      "1": { status: "completed", attempts: 1, budgetUsed: 2 },
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
    };

    const output = formatPhaseTable(phases);
    const phaseLines = output.split("\n").filter((l) => /Phase \d+:/.test(l));

    // Verify numerical order: 1, 2, 3, 10
    expect(phaseLines[0]).toContain("Phase 1:");
    expect(phaseLines[1]).toContain("Phase 2:");
    expect(phaseLines[2]).toContain("Phase 3:");
    expect(phaseLines[3]).toContain("Phase 10:");
  });
});

// ---------------------------------------------------------------------------
// CLI command wiring integration (CLI-01, CLI-02, CLI-03, CLI-05)
// ---------------------------------------------------------------------------

describe("CLI command wiring integration", () => {
  it("TestCliWiring_CreateCliRegistersAllFiveCommands", async () => {
    // Dynamic import to ensure fresh module -- note this tests actual wiring
    // without mocking, just creating the CLI object
    const { createCli } = await import("../../src/cli/index.js");
    const cli = createCli();

    const commandNames = cli.commands.map((c) => c.name());
    expect(commandNames).toContain("init");
    expect(commandNames).toContain("run");
    expect(commandNames).toContain("phase");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("resume");
    expect(commandNames).toHaveLength(5);
  });

  it("TestCliWiring_ResumeCommandHasEnvOption", async () => {
    const { createCli } = await import("../../src/cli/index.js");
    const cli = createCli();

    const resumeCmd = cli.commands.find((c) => c.name() === "resume");
    expect(resumeCmd).toBeDefined();

    const envOption = resumeCmd!.options.find((o) => o.long === "--env");
    expect(envOption).toBeDefined();
  });

  it("TestCliWiring_ResumeCommandHasGuidanceOption", async () => {
    const { createCli } = await import("../../src/cli/index.js");
    const cli = createCli();

    const resumeCmd = cli.commands.find((c) => c.name() === "resume");
    expect(resumeCmd).toBeDefined();

    const guidanceOption = resumeCmd!.options.find((o) => o.long === "--guidance");
    expect(guidanceOption).toBeDefined();
  });

  it("TestCliWiring_PhaseCommandAcceptsNumberArgument", async () => {
    const { createCli } = await import("../../src/cli/index.js");
    const cli = createCli();

    const phaseCmd = cli.commands.find((c) => c.name() === "phase");
    expect(phaseCmd).toBeDefined();

    // Commander stores args in _args -- check the command takes an argument
    const args = phaseCmd!.registeredArguments || [];
    expect(args.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test pyramid enforcement integration (TEST-05)
// ---------------------------------------------------------------------------

describe("Test pyramid enforcement integration", () => {
  it("TestPyramidEnforcement_PassesWithValidPyramidAndGrowth", () => {
    const result = enforceTestPyramid(
      { unit: 20, integration: 10, scenario: 5 },
      { unit: 10, integration: 5, scenario: 2 },
    );

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("TestPyramidEnforcement_DetectsShapeAndGrowthViolationsTogether", () => {
    // Inverted pyramid AND no growth
    const result = enforceTestPyramid(
      { unit: 3, integration: 10, scenario: 5 },
      { unit: 5, integration: 10, scenario: 5 },
    );

    expect(result.passed).toBe(false);
    // Should have both pyramid and growth violations
    const pyramidViolations = result.violations.filter((v) => v.includes("Pyramid violation"));
    const growthViolations = result.violations.filter((v) => v.includes("Growth violation"));

    expect(pyramidViolations.length).toBeGreaterThan(0);
    expect(growthViolations.length).toBeGreaterThan(0);
  });
});
