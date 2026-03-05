/**
 * Traceability & Testing Methodology Unit Tests
 *
 * Tests all traceability functions using an in-memory filesystem (Map-based).
 *
 * Requirements: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
 */

import { describe, it, expect } from "vitest";

import {
  createTestGuide,
  updateTestGuide,
  parseTestGuide,
  verifyTestCoverage,
  enforceTestPyramid,
  injectTestingMethodology,
  generateTestingMethodologyBlock,
  type FsLike,
  type Requirement,
  type TestMapping,
  type TestMethodologyConfig,
} from "./traceability.js";

// ---------------------------------------------------------------------------
// In-memory filesystem helper
// ---------------------------------------------------------------------------

function createMemoryFs(): FsLike & { files: Map<string, string> } {
  const files = new Map<string, string>();

  return {
    files,
    existsSync(path: string): boolean {
      return files.has(path);
    },
    readFileSync(path: string, _encoding: "utf-8"): string {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    writeFileSync(path: string, content: string): void {
      files.set(path, content);
    },
    mkdirSync(_path: string, _options?: { recursive: boolean }): void {
      // no-op for in-memory fs
    },
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_REQUIREMENTS: Requirement[] = [
  { id: "R1", description: "User Registration" },
  { id: "R2", description: "User Login" },
  { id: "R3", description: "Password Reset" },
];

const GUIDE_PATH = "/project/TEST_GUIDE.md";

const DEFAULT_CONFIG: TestMethodologyConfig = {
  testNaming: "Test<Component>_<Behavior>[_<Condition>]",
  tiers: [
    "Unit tests -- Test individual functions/methods in isolation",
    "Integration tests -- Test component interactions",
    "Scenario tests -- Test full user workflows end-to-end",
  ],
  requirementPrefix: "R",
};

// ---------------------------------------------------------------------------
// createTestGuide
// ---------------------------------------------------------------------------

describe("createTestGuide", () => {
  describe("TestCreateTestGuide_CreatesCorrectTable", () => {
    it("creates a markdown table with all requirements", () => {
      const fs = createMemoryFs();

      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      expect(fs.files.has(GUIDE_PATH)).toBe(true);
      const content = fs.files.get(GUIDE_PATH)!;

      // Header
      expect(content).toContain("# Test Guide -- Requirement Traceability");
      expect(content).toContain("| Req ID | Requirement | Unit Tests | Integration Tests | Scenario Tests |");

      // Rows
      expect(content).toContain("| R1 | User Registration | TBD | TBD | TBD |");
      expect(content).toContain("| R2 | User Login | TBD | TBD | TBD |");
      expect(content).toContain("| R3 | Password Reset | TBD | TBD | TBD |");
    });

    it("creates correct number of rows", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);
      expect(entries).toHaveLength(3);
    });
  });
});

// ---------------------------------------------------------------------------
// updateTestGuide
// ---------------------------------------------------------------------------

describe("updateTestGuide", () => {
  describe("TestUpdateTestGuide_AppendsTestNames", () => {
    it("appends test names to correct columns", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const mappings: TestMapping[] = [
        { reqId: "R1", tier: "unit", testName: "TestHashPassword" },
        { reqId: "R1", tier: "integration", testName: "TestCreateUser_Success" },
        { reqId: "R1", tier: "scenario", testName: "TestUserRegistrationFlow" },
      ];

      updateTestGuide(["R1"], mappings, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);
      const r1 = entries.find((e) => e.reqId === "R1")!;

      expect(r1.unitTests).toEqual(["TestHashPassword"]);
      expect(r1.integrationTests).toEqual(["TestCreateUser_Success"]);
      expect(r1.scenarioTests).toEqual(["TestUserRegistrationFlow"]);
    });

    it("only updates specified requirement IDs", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const mappings: TestMapping[] = [
        { reqId: "R1", tier: "unit", testName: "TestHash" },
      ];

      updateTestGuide(["R1"], mappings, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);
      const r2 = entries.find((e) => e.reqId === "R2")!;
      // R2 should still be TBD (empty)
      expect(r2.unitTests).toEqual([]);
    });

    it("appends multiple tests to the same column", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const mappings: TestMapping[] = [
        { reqId: "R2", tier: "unit", testName: "TestLoginValidation" },
        { reqId: "R2", tier: "unit", testName: "TestTokenGeneration" },
      ];

      updateTestGuide(["R2"], mappings, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);
      const r2 = entries.find((e) => e.reqId === "R2")!;
      expect(r2.unitTests).toEqual(["TestLoginValidation", "TestTokenGeneration"]);
    });
  });

  describe("TestUpdateTestGuide_IsIdempotent", () => {
    it("does not duplicate test names on repeated calls", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const mappings: TestMapping[] = [
        { reqId: "R1", tier: "unit", testName: "TestHashPassword" },
      ];

      // Call twice
      updateTestGuide(["R1"], mappings, GUIDE_PATH, fs);
      updateTestGuide(["R1"], mappings, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);
      const r1 = entries.find((e) => e.reqId === "R1")!;
      expect(r1.unitTests).toEqual(["TestHashPassword"]);
    });
  });
});

// ---------------------------------------------------------------------------
// parseTestGuide
// ---------------------------------------------------------------------------

describe("parseTestGuide", () => {
  describe("TestParseTestGuide_ParsesCorrectly", () => {
    it("parses an empty guide (TBD cells) correctly", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const entries = parseTestGuide(GUIDE_PATH, fs);

      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({
        reqId: "R1",
        description: "User Registration",
        unitTests: [],
        integrationTests: [],
        scenarioTests: [],
      });
    });

    it("parses populated cells with multiple tests", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      // Populate some tests
      updateTestGuide(
        ["R1"],
        [
          { reqId: "R1", tier: "unit", testName: "TestA" },
          { reqId: "R1", tier: "unit", testName: "TestB" },
          { reqId: "R1", tier: "integration", testName: "TestInteg" },
        ],
        GUIDE_PATH,
        fs,
      );

      const entries = parseTestGuide(GUIDE_PATH, fs);
      const r1 = entries.find((e) => e.reqId === "R1")!;

      expect(r1.unitTests).toEqual(["TestA", "TestB"]);
      expect(r1.integrationTests).toEqual(["TestInteg"]);
      expect(r1.scenarioTests).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// verifyTestCoverage
// ---------------------------------------------------------------------------

describe("verifyTestCoverage", () => {
  describe("TestVerifyTestCoverage_IdentifiesGaps", () => {
    it("identifies uncovered requirements", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      const result = verifyTestCoverage(GUIDE_PATH, fs);

      // All requirements are uncovered (TBD)
      expect(result.covered).toEqual([]);
      expect(result.uncovered).toEqual(["R1", "R2", "R3"]);
      expect(result.missingTiers).toHaveLength(3);
      expect(result.missingTiers[0].missing).toEqual([
        "unit",
        "integration",
        "scenario",
      ]);
    });

    it("marks fully covered requirements", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      // Cover R1 fully
      updateTestGuide(
        ["R1"],
        [
          { reqId: "R1", tier: "unit", testName: "U1" },
          { reqId: "R1", tier: "integration", testName: "I1" },
          { reqId: "R1", tier: "scenario", testName: "S1" },
        ],
        GUIDE_PATH,
        fs,
      );

      const result = verifyTestCoverage(GUIDE_PATH, fs);

      expect(result.covered).toEqual(["R1"]);
      expect(result.uncovered).toEqual(["R2", "R3"]);
    });

    it("identifies specific missing tiers", () => {
      const fs = createMemoryFs();
      createTestGuide(SAMPLE_REQUIREMENTS, GUIDE_PATH, fs);

      // Cover R2 partially (only unit)
      updateTestGuide(
        ["R2"],
        [{ reqId: "R2", tier: "unit", testName: "U1" }],
        GUIDE_PATH,
        fs,
      );

      const result = verifyTestCoverage(GUIDE_PATH, fs);
      const r2Missing = result.missingTiers.find(
        (m) => m.reqId === "R2",
      )!;
      expect(r2Missing.missing).toEqual(["integration", "scenario"]);
    });
  });
});

// ---------------------------------------------------------------------------
// enforceTestPyramid
// ---------------------------------------------------------------------------

describe("enforceTestPyramid", () => {
  describe("TestEnforceTestPyramid_PassesValidPyramid", () => {
    it("passes when pyramid shape holds and counts increase", () => {
      const result = enforceTestPyramid(
        { unit: 10, integration: 5, scenario: 2 },
        { unit: 5, integration: 3, scenario: 1 },
      );

      expect(result.passed).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });

  describe("TestEnforceTestPyramid_FailsInvertedPyramid", () => {
    it("fails when pyramid is inverted (unit < integration)", () => {
      const result = enforceTestPyramid(
        { unit: 3, integration: 10, scenario: 2 },
        { unit: 2, integration: 5, scenario: 1 },
      );

      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(
        expect.stringContaining("Pyramid violation"),
      );
      expect(result.violations).toContainEqual(
        expect.stringContaining("unit tests (3) < integration tests (10)"),
      );
    });

    it("fails when integration < scenario", () => {
      const result = enforceTestPyramid(
        { unit: 20, integration: 2, scenario: 5 },
        { unit: 10, integration: 1, scenario: 1 },
      );

      expect(result.passed).toBe(false);
      expect(result.violations).toContainEqual(
        expect.stringContaining("integration tests (2) < scenario tests (5)"),
      );
    });
  });

  describe("TestEnforceTestPyramid_FailsWhenCountsDontIncrease", () => {
    it("fails when counts do not increase from previous", () => {
      const result = enforceTestPyramid(
        { unit: 5, integration: 3, scenario: 1 },
        { unit: 5, integration: 3, scenario: 1 },
      );

      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(3);
      expect(result.violations[0]).toContain("Growth violation");
      expect(result.violations[0]).toContain("unit tests did not increase");
    });

    it("fails when only some counts increase", () => {
      const result = enforceTestPyramid(
        { unit: 10, integration: 3, scenario: 2 },
        { unit: 5, integration: 3, scenario: 1 },
      );

      expect(result.passed).toBe(false);
      // Only integration should fail growth
      const growthViolations = result.violations.filter((v) =>
        v.includes("Growth violation"),
      );
      expect(growthViolations).toHaveLength(1);
      expect(growthViolations[0]).toContain("integration tests did not increase");
    });
  });
});

// ---------------------------------------------------------------------------
// injectTestingMethodology
// ---------------------------------------------------------------------------

describe("injectTestingMethodology", () => {
  describe("TestInjectTestingMethodology_AppendsToClaudeMd", () => {
    it("appends testing methodology to existing CLAUDE.md", () => {
      const fs = createMemoryFs();
      const claudePath = "/project/CLAUDE.md";
      fs.writeFileSync(claudePath, "# My Project\n\nExisting content.\n");

      injectTestingMethodology(claudePath, DEFAULT_CONFIG, fs);

      const content = fs.readFileSync(claudePath, "utf-8");
      expect(content).toContain("# My Project");
      expect(content).toContain("Existing content.");
      expect(content).toContain("<!-- FORGE:TESTING_METHODOLOGY -->");
      expect(content).toContain("<!-- /FORGE:TESTING_METHODOLOGY -->");
      expect(content).toContain("# Testing Requirements (Forge)");
      expect(content).toContain("Test<Component>_<Behavior>[_<Condition>]");
    });

    it("creates CLAUDE.md if it does not exist", () => {
      const fs = createMemoryFs();
      const claudePath = "/project/CLAUDE.md";

      injectTestingMethodology(claudePath, DEFAULT_CONFIG, fs);

      expect(fs.existsSync(claudePath)).toBe(true);
      const content = fs.readFileSync(claudePath, "utf-8");
      expect(content).toContain("<!-- FORGE:TESTING_METHODOLOGY -->");
    });
  });

  describe("TestInjectTestingMethodology_IsIdempotent", () => {
    it("does not inject twice", () => {
      const fs = createMemoryFs();
      const claudePath = "/project/CLAUDE.md";
      fs.writeFileSync(claudePath, "# Project\n");

      // Inject twice
      injectTestingMethodology(claudePath, DEFAULT_CONFIG, fs);
      const afterFirst = fs.readFileSync(claudePath, "utf-8");

      injectTestingMethodology(claudePath, DEFAULT_CONFIG, fs);
      const afterSecond = fs.readFileSync(claudePath, "utf-8");

      expect(afterFirst).toBe(afterSecond);

      // Marker should appear exactly once
      const count = (afterSecond.match(/FORGE:TESTING_METHODOLOGY/g) || [])
        .length;
      // Two markers: start and end
      expect(count).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// generateTestingMethodologyBlock
// ---------------------------------------------------------------------------

describe("generateTestingMethodologyBlock", () => {
  describe("TestGenerateBlock_ProducesCorrectMarkdown", () => {
    it("produces markdown with start and end markers", () => {
      const block = generateTestingMethodologyBlock(DEFAULT_CONFIG);

      expect(block).toContain("<!-- FORGE:TESTING_METHODOLOGY -->");
      expect(block).toContain("<!-- /FORGE:TESTING_METHODOLOGY -->");
    });

    it("includes test naming pattern", () => {
      const block = generateTestingMethodologyBlock(DEFAULT_CONFIG);
      expect(block).toContain("Test<Component>_<Behavior>[_<Condition>]");
    });

    it("includes all tiers", () => {
      const block = generateTestingMethodologyBlock(DEFAULT_CONFIG);

      for (const tier of DEFAULT_CONFIG.tiers) {
        expect(block).toContain(tier);
      }
    });

    it("includes requirement prefix", () => {
      const block = generateTestingMethodologyBlock({
        ...DEFAULT_CONFIG,
        requirementPrefix: "REQ",
      });
      expect(block).toContain("REQ");
    });

    it("includes test pyramid expectations", () => {
      const block = generateTestingMethodologyBlock(DEFAULT_CONFIG);
      expect(block).toContain("unit >= integration >= scenario");
    });
  });
});
