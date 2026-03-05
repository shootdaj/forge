/**
 * Requirements Module Unit Tests
 *
 * Tests for requirements gathering, parsing, compliance detection,
 * and document formatting.
 *
 * Requirements: REQ-01, REQ-02, REQ-03, REQ-04
 */

import { describe, it, expect, vi } from "vitest";
import { buildRequirementsPrompt, gatherRequirements } from "./gatherer.js";
import {
  parseRequirementsOutput,
  detectComplianceFlags,
  formatRequirementsDoc,
} from "./parser.js";
import type { Requirement, ComplianceFlags } from "./types.js";
import type { ForgeConfig } from "../config/schema.js";
import type { QueryResult } from "../sdk/types.js";

// ─── Test Fixtures ──────────────────────────────────────────────

const SAMPLE_MARKDOWN = `
## R1: User Authentication

**Category:** Security
**Description:** Users must be able to sign in with email and password.
**Acceptance Criteria:**
- User can register with email and password
- User can log in with valid credentials
- Failed login shows error message
**Edge Cases:**
- Case-insensitive email matching
- Account lockout after 5 failed attempts
**Performance:** Login response under 200ms
**Security:** Passwords hashed with bcrypt, audit log for all auth events
**Observability:** Track login success/failure rates

## R2: Data Export

**Category:** Data
**Description:** Users can export their data in CSV and JSON formats.
**Acceptance Criteria:**
- Export button available on dashboard
- CSV format includes all user records
- JSON format is valid and parseable
**Edge Cases:**
- Empty dataset produces valid empty file
- Large datasets (>100k rows) handled without timeout
**Performance:** Export completes within 30 seconds for datasets up to 1M rows

## R3: GDPR Consent Management

**Category:** Security
**Description:** Users must provide explicit consent for data processing per GDPR requirements.
**Acceptance Criteria:**
- Consent banner shown on first visit
- User can withdraw consent at any time
- Right to erasure implemented within 30 days
**Edge Cases:**
- User revokes consent mid-session
- Consent records preserved for audit
**Security:** All consent changes logged, data protection officer notification
`;

const MINIMAL_MARKDOWN = `
## R1: Basic Feature

**Description:** A simple feature.
**Acceptance Criteria:**
- It works
`;

const EMPTY_MARKDOWN = "";

/**
 * Create a minimal ForgeConfig for testing.
 */
function createTestConfig(
  overrides?: Partial<ForgeConfig>,
): ForgeConfig {
  return {
    model: "claude-opus-4-6",
    maxBudgetTotal: 200,
    maxBudgetPerStep: 15,
    maxRetries: 3,
    maxComplianceRounds: 5,
    maxTurnsPerStep: 200,
    testing: {
      stack: "node",
      unitCommand: "npm test -- --json",
      integrationCommand: "npm run test:integration -- --json",
      scenarioCommand: "npm run test:e2e",
      dockerComposeFile: "docker-compose.test.yml",
    },
    verification: {
      files: true,
      tests: true,
      typecheck: true,
      lint: true,
      dockerSmoke: false,
      testCoverageCheck: true,
      observabilityCheck: false,
      deployment: false,
    },
    notion: {
      parentPageId: "",
      docPages: {
        architecture: "",
        dataFlow: "",
        apiReference: "",
        componentIndex: "",
        adrs: "",
        deployment: "",
        devWorkflow: "",
        phaseReports: "",
      },
    },
    parallelism: {
      maxConcurrentPhases: 3,
      enableSubagents: true,
      backgroundDocs: true,
    },
    deployment: {
      target: "vercel",
      environments: ["development", "staging", "production"],
    },
    notifications: {
      onHumanNeeded: "stdout",
      onPhaseComplete: "stdout",
      onFailure: "stdout",
    },
    ...overrides,
  };
}

/**
 * Create a mock executeQuery that returns the given markdown.
 */
function createMockExecuteQuery(
  markdown: string,
): (opts: Record<string, unknown>) => Promise<QueryResult> {
  return vi.fn().mockResolvedValue({
    ok: true,
    result: markdown,
    structuredOutput: undefined,
    sessionId: "test-session-123",
    cost: {
      totalCostUsd: 0.50,
      numTurns: 5,
      usage: {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      modelUsage: {},
      durationMs: 5000,
      durationApiMs: 4000,
    },
    permissionDenials: [],
  } satisfies QueryResult);
}

/**
 * Create a mock executeQuery that returns a failure.
 */
function createFailingExecuteQuery(
  message: string,
): (opts: Record<string, unknown>) => Promise<QueryResult> {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: {
      category: "execution_error",
      message,
      mayHavePartialWork: false,
    },
    sessionId: "test-session-fail",
    cost: {
      totalCostUsd: 0.10,
      numTurns: 1,
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      modelUsage: {},
      durationMs: 1000,
      durationApiMs: 800,
    },
  } satisfies QueryResult);
}

// ─── buildRequirementsPrompt Tests ──────────────────────────────

describe("buildRequirementsPrompt", () => {
  it("TestBuildPrompt_ContainsAllCategories", () => {
    const prompt = buildRequirementsPrompt();
    const categories = [
      "Core",
      "Data",
      "Security",
      "Integrations",
      "Quality",
      "Infrastructure",
      "UX",
      "Business",
    ];
    for (const cat of categories) {
      expect(prompt).toContain(cat);
    }
  });

  it("TestBuildPrompt_ContainsFormatInstruction", () => {
    const prompt = buildRequirementsPrompt();
    expect(prompt).toContain("## R{N}: Title");
    expect(prompt).toContain("**Description:**");
    expect(prompt).toContain("**Acceptance Criteria:**");
    expect(prompt).toContain("**Edge Cases:**");
  });

  it("TestBuildPrompt_IncludesProjectName", () => {
    const prompt = buildRequirementsPrompt("MyProject");
    expect(prompt).toContain('"MyProject"');
  });

  it("TestBuildPrompt_HandlesNoProjectName", () => {
    const prompt = buildRequirementsPrompt();
    expect(prompt).toContain("for this project");
  });

  it("TestBuildPrompt_Covers25PlusTopics", () => {
    const prompt = buildRequirementsPrompt();
    // Count bullet points (lines starting with "- ")
    const bullets = prompt.split("\n").filter((l) => l.trim().startsWith("- "));
    expect(bullets.length).toBeGreaterThanOrEqual(25);
  });
});

// ─── parseRequirementsOutput Tests ──────────────────────────────

describe("parseRequirementsOutput", () => {
  it("TestParse_WellFormedMarkdown", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    expect(reqs).toHaveLength(3);

    expect(reqs[0].id).toBe("R1");
    expect(reqs[0].title).toBe("User Authentication");
    expect(reqs[0].category).toBe("Security");
    expect(reqs[0].description).toContain("sign in with email");
    expect(reqs[0].acceptanceCriteria).toHaveLength(3);
    expect(reqs[0].edgeCases).toHaveLength(2);
    expect(reqs[0].performance).toContain("200ms");
    expect(reqs[0].security).toContain("bcrypt");
    expect(reqs[0].observability).toContain("login success");
  });

  it("TestParse_MultipleRequirements", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    expect(reqs[1].id).toBe("R2");
    expect(reqs[1].title).toBe("Data Export");
    expect(reqs[1].category).toBe("Data");
    expect(reqs[1].acceptanceCriteria).toHaveLength(3);
    expect(reqs[1].edgeCases).toHaveLength(2);
  });

  it("TestParse_MissingOptionalFields", () => {
    const reqs = parseRequirementsOutput(MINIMAL_MARKDOWN);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("R1");
    expect(reqs[0].title).toBe("Basic Feature");
    expect(reqs[0].category).toBe("Core"); // Default
    expect(reqs[0].description).toBe("A simple feature.");
    expect(reqs[0].acceptanceCriteria).toHaveLength(1);
    expect(reqs[0].edgeCases).toHaveLength(0);
    expect(reqs[0].performance).toBeUndefined();
    expect(reqs[0].security).toBeUndefined();
    expect(reqs[0].observability).toBeUndefined();
  });

  it("TestParse_EmptyInput", () => {
    expect(parseRequirementsOutput("")).toEqual([]);
    expect(parseRequirementsOutput("   ")).toEqual([]);
  });

  it("TestParse_NoRequirementHeaders", () => {
    const reqs = parseRequirementsOutput(
      "Some random text without any requirement headers",
    );
    expect(reqs).toEqual([]);
  });

  it("TestParse_AcceptanceCriteriaAsBulletList", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    expect(reqs[0].acceptanceCriteria).toContain(
      "User can register with email and password",
    );
    expect(reqs[0].acceptanceCriteria).toContain(
      "User can log in with valid credentials",
    );
    expect(reqs[0].acceptanceCriteria).toContain(
      "Failed login shows error message",
    );
  });

  it("TestParse_EdgeCasesAsBulletList", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    expect(reqs[0].edgeCases).toContain("Case-insensitive email matching");
    expect(reqs[0].edgeCases).toContain(
      "Account lockout after 5 failed attempts",
    );
  });
});

// ─── detectComplianceFlags Tests ────────────────────────────────

describe("detectComplianceFlags", () => {
  it("TestCompliance_DetectsSOC2FromAuditLog", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Audit",
        category: "Security",
        description: "System must maintain comprehensive audit log",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.soc2).toBe(true);
    expect(flags.hipaa).toBe(false);
  });

  it("TestCompliance_DetectsGDPRFromConsent", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Consent",
        category: "Security",
        description: "Users must provide explicit consent for data processing",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.gdpr).toBe(true);
  });

  it("TestCompliance_DetectsGDPRFromRightToErasure", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Erasure",
        category: "Data",
        description: "Support right to erasure for all user data",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.gdpr).toBe(true);
  });

  it("TestCompliance_DetectsHIPAAFromPHI", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Health Data",
        category: "Data",
        description: "Handle PHI according to federal regulations",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.hipaa).toBe(true);
  });

  it("TestCompliance_DetectsPCIDSSFromPaymentCard", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Payments",
        category: "Integrations",
        description: "Process payment card data securely",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.pciDss).toBe(true);
  });

  it("TestCompliance_DetectsWCAGFromAccessibility", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "A11y",
        category: "UX",
        description: "Meet accessibility standards for all interactive elements",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.wcag).toBe(true);
  });

  it("TestCompliance_DetectsWCAGFromScreenReader", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Screen Reader",
        category: "UX",
        description: "All pages must work with screen reader software",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.wcag).toBe(true);
  });

  it("TestCompliance_AllFalseWhenNoKeywords", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Simple",
        category: "Core",
        description: "A simple feature with no compliance implications",
        acceptanceCriteria: ["It works"],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.soc2).toBe(false);
    expect(flags.hipaa).toBe(false);
    expect(flags.gdpr).toBe(false);
    expect(flags.pciDss).toBe(false);
    expect(flags.wcag).toBe(false);
  });

  it("TestCompliance_DetectsMultipleFlags", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    const flags = detectComplianceFlags(reqs);
    // R1 has "audit log" -> SOC 2, R3 has "GDPR", "consent", "right to erasure" -> GDPR
    expect(flags.soc2).toBe(true);
    expect(flags.gdpr).toBe(true);
  });

  it("TestCompliance_CaseInsensitiveMatching", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "HIPAA",
        category: "Security",
        description: "Must comply with HIPAA regulations",
        acceptanceCriteria: [],
        edgeCases: [],
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.hipaa).toBe(true);
  });

  it("TestCompliance_ScansSecurityField", () => {
    const reqs: Requirement[] = [
      {
        id: "R1",
        title: "Auth",
        category: "Security",
        description: "Basic authentication",
        acceptanceCriteria: [],
        edgeCases: [],
        security: "Data protection measures required",
      },
    ];
    const flags = detectComplianceFlags(reqs);
    expect(flags.gdpr).toBe(true); // "data protection" is a GDPR keyword
  });
});

// ─── formatRequirementsDoc Tests ────────────────────────────────

describe("formatRequirementsDoc", () => {
  it("TestFormat_CorrectHeaders", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    const flags = detectComplianceFlags(reqs);
    const doc = formatRequirementsDoc(reqs, flags);

    expect(doc).toContain("# Requirements");
    expect(doc).toContain("## R1: User Authentication");
    expect(doc).toContain("## R2: Data Export");
    expect(doc).toContain("## R3: GDPR Consent Management");
  });

  it("TestFormat_IncludesComplianceSection", () => {
    const flags: ComplianceFlags = {
      soc2: true,
      hipaa: false,
      gdpr: true,
      pciDss: false,
      wcag: false,
    };
    const doc = formatRequirementsDoc([], flags);
    expect(doc).toContain("## Compliance");
    expect(doc).toContain("- SOC 2");
    expect(doc).toContain("- GDPR");
    expect(doc).not.toContain("- HIPAA");
    expect(doc).not.toContain("- PCI DSS");
  });

  it("TestFormat_NoComplianceSectionWhenNoFlags", () => {
    const flags: ComplianceFlags = {
      soc2: false,
      hipaa: false,
      gdpr: false,
      pciDss: false,
      wcag: false,
    };
    const doc = formatRequirementsDoc([], flags);
    expect(doc).not.toContain("## Compliance");
  });

  it("TestFormat_IncludesAllFields", () => {
    const reqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    const flags: ComplianceFlags = {
      soc2: false,
      hipaa: false,
      gdpr: false,
      pciDss: false,
      wcag: false,
    };
    const doc = formatRequirementsDoc(reqs, flags);

    expect(doc).toContain("**Category:** Security");
    expect(doc).toContain("**Description:**");
    expect(doc).toContain("**Acceptance Criteria:**");
    expect(doc).toContain("- User can register with email and password");
    expect(doc).toContain("**Edge Cases:**");
    expect(doc).toContain("**Performance:**");
    expect(doc).toContain("**Security:**");
    expect(doc).toContain("**Observability:**");
  });

  it("TestFormat_OmitsEmptyOptionalFields", () => {
    const reqs = parseRequirementsOutput(MINIMAL_MARKDOWN);
    const flags: ComplianceFlags = {
      soc2: false,
      hipaa: false,
      gdpr: false,
      pciDss: false,
      wcag: false,
    };
    const doc = formatRequirementsDoc(reqs, flags);

    expect(doc).toContain("## R1: Basic Feature");
    expect(doc).not.toContain("**Performance:**");
    expect(doc).not.toContain("**Security:**");
    expect(doc).not.toContain("**Observability:**");
  });

  it("TestFormat_ProducesParsableMarkdown_RoundTrip", () => {
    const originalReqs = parseRequirementsOutput(SAMPLE_MARKDOWN);
    const flags = detectComplianceFlags(originalReqs);
    const doc = formatRequirementsDoc(originalReqs, flags);

    // Re-parse the formatted output
    const reparsed = parseRequirementsOutput(doc);
    expect(reparsed).toHaveLength(originalReqs.length);

    for (let i = 0; i < originalReqs.length; i++) {
      expect(reparsed[i].id).toBe(originalReqs[i].id);
      expect(reparsed[i].title).toBe(originalReqs[i].title);
      expect(reparsed[i].category).toBe(originalReqs[i].category);
      expect(reparsed[i].description).toBe(originalReqs[i].description);
      expect(reparsed[i].acceptanceCriteria).toEqual(
        originalReqs[i].acceptanceCriteria,
      );
      expect(reparsed[i].edgeCases).toEqual(originalReqs[i].edgeCases);
    }
  });

  it("TestFormat_IncludesGenerationDate", () => {
    const doc = formatRequirementsDoc([], {
      soc2: false,
      hipaa: false,
      gdpr: false,
      pciDss: false,
      wcag: false,
    });
    // Should contain a date in YYYY-MM-DD format
    expect(doc).toMatch(/Generated: \d{4}-\d{2}-\d{2}/);
  });
});

// ─── gatherRequirements Integration Tests (mocked SDK) ─────────

describe("gatherRequirements", () => {
  it("TestGather_ReturnsGatherResult", async () => {
    const mockQuery = createMockExecuteQuery(SAMPLE_MARKDOWN);
    const config = createTestConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as unknown as typeof import("../sdk/query-wrapper.js").executeQuery,
      projectName: "TestProject",
    });

    expect(result.requirements).toHaveLength(3);
    expect(result.requirements[0].id).toBe("R1");
    expect(result.complianceFlags.soc2).toBe(true);
    expect(result.complianceFlags.gdpr).toBe(true);
    expect(result.rawOutput).toBe(SAMPLE_MARKDOWN);
    expect(result.formattedDoc).toContain("# Requirements");
  });

  it("TestGather_ThrowsOnSDKFailure", async () => {
    const mockQuery = createFailingExecuteQuery("Agent timed out");
    const config = createTestConfig();

    await expect(
      gatherRequirements(config, {
        executeQueryFn: mockQuery as unknown as typeof import("../sdk/query-wrapper.js").executeQuery,
      }),
    ).rejects.toThrow("Requirements gathering failed: Agent timed out");
  });

  it("TestGather_PassesCorrectOptionsToExecuteQuery", async () => {
    const mockQuery = createMockExecuteQuery(MINIMAL_MARKDOWN);
    const config = createTestConfig({ model: "claude-sonnet-4-5-20250929" });

    await gatherRequirements(config, {
      executeQueryFn: mockQuery as unknown as typeof import("../sdk/query-wrapper.js").executeQuery,
      projectName: "OptionsTest",
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.model).toBe("claude-sonnet-4-5-20250929");
    expect(callArgs.useClaudeCodePreset).toBe(true);
    expect(callArgs.loadSettings).toBe(true);
    expect(callArgs.prompt).toContain('"OptionsTest"');
  });

  it("TestGather_FullPipeline_ParseComplianceFormat", async () => {
    const mockQuery = createMockExecuteQuery(SAMPLE_MARKDOWN);
    const config = createTestConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as unknown as typeof import("../sdk/query-wrapper.js").executeQuery,
    });

    // Verify full pipeline: raw -> parse -> compliance -> format
    expect(result.requirements).toHaveLength(3);
    expect(result.complianceFlags.soc2).toBe(true);
    expect(result.complianceFlags.gdpr).toBe(true);
    expect(result.complianceFlags.hipaa).toBe(false);
    expect(result.complianceFlags.pciDss).toBe(false);
    expect(result.complianceFlags.wcag).toBe(false);
    expect(result.formattedDoc).toContain("## Compliance");
    expect(result.formattedDoc).toContain("## R1: User Authentication");
    expect(result.formattedDoc).toContain("## R2: Data Export");
    expect(result.formattedDoc).toContain("## R3: GDPR Consent Management");
  });

  it("TestGather_HandlesEmptyAgentOutput", async () => {
    const mockQuery = createMockExecuteQuery("");
    const config = createTestConfig();

    const result = await gatherRequirements(config, {
      executeQueryFn: mockQuery as unknown as typeof import("../sdk/query-wrapper.js").executeQuery,
    });

    expect(result.requirements).toHaveLength(0);
    expect(result.complianceFlags.soc2).toBe(false);
    expect(result.formattedDoc).toContain("# Requirements");
  });
});
