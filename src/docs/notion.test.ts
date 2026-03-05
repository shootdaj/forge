/**
 * Forge Notion Documentation Module - Unit Tests
 *
 * Tests all 10 functions in notion.ts with mocked executeQueryFn.
 * Verifies prompt construction, structured output extraction,
 * error handling, and graceful degradation.
 *
 * Requirements: DOC-01, DOC-02, DOC-03, DOC-04
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecuteQueryFn, PhaseReport, ADRRecord, NotionPageIds, MilestoneSummary } from "./types.js";
import {
  createDocPages,
  buildPageUpdatePrompt,
  updateArchitecture,
  updateDataFlow,
  updateApiReference,
  updateComponentIndex,
  updateDevWorkflow,
  createADR,
  createPhaseReport,
  publishFinalDocs,
} from "./notion.js";
import { MANDATORY_PAGES } from "./types.js";

// ── Test Fixtures ──────────────────────────────────────────────────────

const MOCK_PAGE_IDS: NotionPageIds = {
  architecture: "page-arch-001",
  dataFlow: "page-df-002",
  apiReference: "page-api-003",
  componentIndex: "page-ci-004",
  adrs: "page-adr-005",
  deployment: "page-dep-006",
  devWorkflow: "page-dw-007",
  phaseReports: "page-pr-008",
};

const MOCK_PHASE_REPORT: PhaseReport = {
  phaseNumber: 3,
  phaseName: "Step Runner",
  goals: "Build the step runner with SDK integration",
  testResults: { passed: 42, failed: 2, total: 44 },
  architectureChanges: [
    "Added step runner module",
    "New checkpoint file format",
  ],
  issues: ["Flaky test in SDK timeout handling"],
  budgetUsed: 15.5,
};

const MOCK_ADR: ADRRecord = {
  title: "Use injectable executeQueryFn pattern",
  context: "Need testability without burning API tokens",
  decision: "All SDK-dependent functions accept optional executeQueryFn parameter",
  consequences: "Slightly more complex signatures but full test coverage without mocks",
  status: "accepted",
};

const MOCK_SUMMARY: MilestoneSummary = {
  totalPhases: 8,
  totalTests: 450,
  totalBudget: 125.0,
  requirements: { total: 30, verified: 28 },
  highlights: [
    "Autonomous pipeline with wave-based execution",
    "Programmatic verification at every step",
  ],
};

/**
 * Create a mock executeQueryFn that returns success.
 */
function createSuccessMock(
  overrides?: Partial<{
    result: string;
    structuredOutput: unknown;
  }>,
): ExecuteQueryFn {
  return vi.fn().mockResolvedValue({
    ok: true,
    result: overrides?.result ?? "success",
    structuredOutput: overrides?.structuredOutput,
  });
}

/**
 * Create a mock executeQueryFn that returns failure.
 */
function createFailureMock(message = "API error"): ExecuteQueryFn {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { message },
  });
}

// ── createDocPages ─────────────────────────────────────────────────────

describe("createDocPages", () => {
  it("calls executeQueryFn with prompt containing all 8 page names", async () => {
    const mockFn = createSuccessMock({ structuredOutput: MOCK_PAGE_IDS });

    await createDocPages("parent-123", "TestProject", {
      executeQueryFn: mockFn,
    });

    expect(mockFn).toHaveBeenCalledTimes(1);
    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const pageName of MANDATORY_PAGES) {
      expect(call.prompt).toContain(pageName);
    }
  });

  it("includes parentPageId in prompt", async () => {
    const mockFn = createSuccessMock({ structuredOutput: MOCK_PAGE_IDS });

    await createDocPages("parent-xyz-789", "MyApp", {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("parent-xyz-789");
  });

  it("includes projectName in prompt", async () => {
    const mockFn = createSuccessMock({ structuredOutput: MOCK_PAGE_IDS });

    await createDocPages("parent-123", "AwesomeProject", {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("AwesomeProject");
  });

  it("passes outputSchema for structured output extraction", async () => {
    const mockFn = createSuccessMock({ structuredOutput: MOCK_PAGE_IDS });

    await createDocPages("parent-123", "TestProject", {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.outputSchema).toBeDefined();
    expect(call.outputSchema.type).toBe("object");
    expect(call.outputSchema.required).toContain("architecture");
    expect(call.outputSchema.required).toContain("phaseReports");
  });

  it("returns NotionPageIds from structured output", async () => {
    const mockFn = createSuccessMock({ structuredOutput: MOCK_PAGE_IDS });

    const result = await createDocPages("parent-123", "TestProject", {
      executeQueryFn: mockFn,
    });

    expect(result).toEqual(MOCK_PAGE_IDS);
  });

  it("throws on SDK failure", async () => {
    const mockFn = createFailureMock("Notion API rate limited");

    await expect(
      createDocPages("parent-123", "TestProject", {
        executeQueryFn: mockFn,
      }),
    ).rejects.toThrow("Failed to create Notion doc pages");
  });

  it("throws when structured output is missing", async () => {
    const mockFn = createSuccessMock({ structuredOutput: undefined });

    await expect(
      createDocPages("parent-123", "TestProject", {
        executeQueryFn: mockFn,
      }),
    ).rejects.toThrow("No structured output returned");
  });

  it("throws when a page ID is missing from structured output", async () => {
    const incompleteIds = { ...MOCK_PAGE_IDS, architecture: "" };
    const mockFn = createSuccessMock({ structuredOutput: incompleteIds });

    await expect(
      createDocPages("parent-123", "TestProject", {
        executeQueryFn: mockFn,
      }),
    ).rejects.toThrow('Missing page ID for "Architecture"');
  });

  it("throws when no executeQueryFn is provided", async () => {
    await expect(
      createDocPages("parent-123", "TestProject"),
    ).rejects.toThrow("requires an executeQueryFn");
  });
});

// ── buildPageUpdatePrompt ──────────────────────────────────────────────

describe("buildPageUpdatePrompt", () => {
  it("returns prompt containing pageId", () => {
    const prompt = buildPageUpdatePrompt("page-abc-123", "Architecture", "New content");
    expect(prompt).toContain("page-abc-123");
  });

  it("returns prompt containing pageName", () => {
    const prompt = buildPageUpdatePrompt("page-123", "Data Flow", "Updated flow");
    expect(prompt).toContain("Data Flow");
  });

  it("returns prompt containing content", () => {
    const content = "## Updated Architecture\n\nNew microservice added";
    const prompt = buildPageUpdatePrompt("page-123", "Architecture", content);
    expect(prompt).toContain(content);
  });

  it("includes instructions for notion_read_page and notion_update_page", () => {
    const prompt = buildPageUpdatePrompt("page-123", "Test", "content");
    expect(prompt).toContain("notion_read_page");
    expect(prompt).toContain("notion_update_page");
  });
});

// ── Update functions (grouped) ─────────────────────────────────────────

describe("update functions", () => {
  let mockFn: ExecuteQueryFn;

  beforeEach(() => {
    mockFn = createSuccessMock();
  });

  describe("updateArchitecture", () => {
    it("calls executeQueryFn with correct pageId", async () => {
      await updateArchitecture("page-arch-001", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("page-arch-001");
    });

    it("includes architecture changes from phase report", async () => {
      await updateArchitecture("page-arch-001", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("Added step runner module");
      expect(call.prompt).toContain("New checkpoint file format");
    });

    it("does not throw on SDK failure (graceful degradation)", async () => {
      const failMock = createFailureMock("API error");

      await expect(
        updateArchitecture("page-arch-001", MOCK_PHASE_REPORT, {
          executeQueryFn: failMock,
        }),
      ).resolves.toBeUndefined();
    });

    it("does nothing when executeQueryFn is not provided", async () => {
      await expect(
        updateArchitecture("page-arch-001", MOCK_PHASE_REPORT),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateDataFlow", () => {
    it("calls executeQueryFn with correct pageId and phase data", async () => {
      await updateDataFlow("page-df-002", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("page-df-002");
      expect(call.prompt).toContain("Data Flow");
    });

    it("does not throw on SDK failure", async () => {
      const failMock = createFailureMock();
      await expect(
        updateDataFlow("page-df-002", MOCK_PHASE_REPORT, {
          executeQueryFn: failMock,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateApiReference", () => {
    it("calls executeQueryFn with correct pageId and phase data", async () => {
      await updateApiReference("page-api-003", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("page-api-003");
      expect(call.prompt).toContain("API Reference");
    });

    it("does not throw on SDK failure", async () => {
      const failMock = createFailureMock();
      await expect(
        updateApiReference("page-api-003", MOCK_PHASE_REPORT, {
          executeQueryFn: failMock,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateComponentIndex", () => {
    it("calls executeQueryFn with correct pageId and phase data", async () => {
      await updateComponentIndex("page-ci-004", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("page-ci-004");
      expect(call.prompt).toContain("Component Index");
    });

    it("does not throw on SDK failure", async () => {
      const failMock = createFailureMock();
      await expect(
        updateComponentIndex("page-ci-004", MOCK_PHASE_REPORT, {
          executeQueryFn: failMock,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("updateDevWorkflow", () => {
    it("calls executeQueryFn with correct pageId and phase data", async () => {
      await updateDevWorkflow("page-dw-007", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      expect(mockFn).toHaveBeenCalledTimes(1);
      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("page-dw-007");
      expect(call.prompt).toContain("Dev Workflow");
    });

    it("includes issues and budget from phase report", async () => {
      await updateDevWorkflow("page-dw-007", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      });

      const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.prompt).toContain("Flaky test in SDK timeout handling");
      expect(call.prompt).toContain("$15.50");
    });

    it("does not throw on SDK failure", async () => {
      const failMock = createFailureMock();
      await expect(
        updateDevWorkflow("page-dw-007", MOCK_PHASE_REPORT, {
          executeQueryFn: failMock,
        }),
      ).resolves.toBeUndefined();
    });
  });
});

// ── createADR ──────────────────────────────────────────────────────────

describe("createADR", () => {
  it("includes ADR title in prompt", async () => {
    const mockFn = createSuccessMock({ result: "adr-page-id-new" });

    await createADR("parent-adr-005", MOCK_ADR, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain(MOCK_ADR.title);
  });

  it("includes context, decision, and consequences in prompt", async () => {
    const mockFn = createSuccessMock({ result: "adr-page-id-new" });

    await createADR("parent-adr-005", MOCK_ADR, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain(MOCK_ADR.context);
    expect(call.prompt).toContain(MOCK_ADR.decision);
    expect(call.prompt).toContain(MOCK_ADR.consequences);
  });

  it("includes ADR status in prompt", async () => {
    const mockFn = createSuccessMock({ result: "adr-page-id-new" });

    await createADR("parent-adr-005", MOCK_ADR, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("accepted");
  });

  it("returns page ID string", async () => {
    const mockFn = createSuccessMock({ result: "adr-page-id-new" });

    const result = await createADR("parent-adr-005", MOCK_ADR, {
      executeQueryFn: mockFn,
    });

    expect(result).toBe("adr-page-id-new");
  });

  it("throws on SDK failure", async () => {
    const mockFn = createFailureMock("Permission denied");

    await expect(
      createADR("parent-adr-005", MOCK_ADR, {
        executeQueryFn: mockFn,
      }),
    ).rejects.toThrow("Failed to create ADR page");
  });

  it("throws when no executeQueryFn is provided", async () => {
    await expect(
      createADR("parent-adr-005", MOCK_ADR),
    ).rejects.toThrow("requires an executeQueryFn");
  });
});

// ── createPhaseReport ──────────────────────────────────────────────────

describe("createPhaseReport", () => {
  it("includes phase number and name in prompt", async () => {
    const mockFn = createSuccessMock({ result: "report-page-id" });

    await createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("Phase 3");
    expect(call.prompt).toContain("Step Runner");
  });

  it("includes goals in prompt", async () => {
    const mockFn = createSuccessMock({ result: "report-page-id" });

    await createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("Build the step runner with SDK integration");
  });

  it("includes test results in prompt", async () => {
    const mockFn = createSuccessMock({ result: "report-page-id" });

    await createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("42");
    expect(call.prompt).toContain("44");
  });

  it("includes budget in prompt", async () => {
    const mockFn = createSuccessMock({ result: "report-page-id" });

    await createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("$15.50");
  });

  it("returns page ID string", async () => {
    const mockFn = createSuccessMock({ result: "report-page-id" });

    const result = await createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
      executeQueryFn: mockFn,
    });

    expect(result).toBe("report-page-id");
  });

  it("throws on SDK failure", async () => {
    const mockFn = createFailureMock("Timeout");

    await expect(
      createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT, {
        executeQueryFn: mockFn,
      }),
    ).rejects.toThrow("Failed to create phase report page");
  });

  it("throws when no executeQueryFn is provided", async () => {
    await expect(
      createPhaseReport("parent-pr-008", MOCK_PHASE_REPORT),
    ).rejects.toThrow("requires an executeQueryFn");
  });
});

// ── publishFinalDocs ───────────────────────────────────────────────────

describe("publishFinalDocs", () => {
  it("calls executeQueryFn for each of the 8 pages plus milestone summary", async () => {
    const mockFn = createSuccessMock();

    await publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY, {
      executeQueryFn: mockFn,
    });

    // 8 page updates + 1 milestone summary creation = 9 calls
    expect(mockFn).toHaveBeenCalledTimes(9);
  });

  it("includes milestone summary data in prompts", async () => {
    const mockFn = createSuccessMock();

    await publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY, {
      executeQueryFn: mockFn,
    });

    const calls = (mockFn as ReturnType<typeof vi.fn>).mock.calls;
    // Check the first page update prompt
    const firstPrompt = calls[0][0].prompt;
    expect(firstPrompt).toContain("8"); // totalPhases
    expect(firstPrompt).toContain("450"); // totalTests
    expect(firstPrompt).toContain("$125.00"); // totalBudget
    expect(firstPrompt).toContain("28/30"); // requirements
  });

  it("includes highlights in prompts", async () => {
    const mockFn = createSuccessMock();

    await publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY, {
      executeQueryFn: mockFn,
    });

    const calls = (mockFn as ReturnType<typeof vi.fn>).mock.calls;
    const firstPrompt = calls[0][0].prompt;
    expect(firstPrompt).toContain("Autonomous pipeline with wave-based execution");
  });

  it("does nothing when executeQueryFn is not provided", async () => {
    // Should not throw
    await expect(
      publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY),
    ).resolves.toBeUndefined();
  });

  it("does not throw when individual page updates fail", async () => {
    const mockFn = createFailureMock("Network error");

    await expect(
      publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY, {
        executeQueryFn: mockFn,
      }),
    ).resolves.toBeUndefined();
  });

  it("creates milestone summary page under phaseReports", async () => {
    const mockFn = createSuccessMock();

    await publishFinalDocs(MOCK_PAGE_IDS, MOCK_SUMMARY, {
      executeQueryFn: mockFn,
    });

    const calls = (mockFn as ReturnType<typeof vi.fn>).mock.calls;
    // Last call should be the milestone summary creation
    const lastPrompt = calls[calls.length - 1][0].prompt;
    expect(lastPrompt).toContain("Milestone Complete - Final Summary");
    expect(lastPrompt).toContain(MOCK_PAGE_IDS.phaseReports);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("updateArchitecture handles empty architecture changes", async () => {
    const mockFn = createSuccessMock();
    const reportNoChanges: PhaseReport = {
      ...MOCK_PHASE_REPORT,
      architectureChanges: [],
    };

    await updateArchitecture("page-arch-001", reportNoChanges, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("No architecture changes");
  });

  it("updateDevWorkflow handles empty issues list", async () => {
    const mockFn = createSuccessMock();
    const reportNoIssues: PhaseReport = {
      ...MOCK_PHASE_REPORT,
      issues: [],
    };

    await updateDevWorkflow("page-dw-007", reportNoIssues, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("No issues encountered");
  });

  it("createPhaseReport handles report with no architecture changes or issues", async () => {
    const mockFn = createSuccessMock({ result: "report-id" });
    const minimalReport: PhaseReport = {
      phaseNumber: 1,
      phaseName: "Init",
      goals: "Setup project",
      testResults: { passed: 0, failed: 0, total: 0 },
      architectureChanges: [],
      issues: [],
      budgetUsed: 0,
    };

    await createPhaseReport("parent-pr", minimalReport, {
      executeQueryFn: mockFn,
    });

    const call = (mockFn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("- None");
  });

  it("update functions handle executeQueryFn that throws", async () => {
    const throwingFn: ExecuteQueryFn = vi.fn().mockRejectedValue(
      new Error("Connection refused"),
    );

    // All update functions should catch and not rethrow
    await expect(
      updateArchitecture("page-arch", MOCK_PHASE_REPORT, {
        executeQueryFn: throwingFn,
      }),
    ).resolves.toBeUndefined();

    await expect(
      updateDataFlow("page-df", MOCK_PHASE_REPORT, {
        executeQueryFn: throwingFn,
      }),
    ).resolves.toBeUndefined();

    await expect(
      updateApiReference("page-api", MOCK_PHASE_REPORT, {
        executeQueryFn: throwingFn,
      }),
    ).resolves.toBeUndefined();

    await expect(
      updateComponentIndex("page-ci", MOCK_PHASE_REPORT, {
        executeQueryFn: throwingFn,
      }),
    ).resolves.toBeUndefined();

    await expect(
      updateDevWorkflow("page-dw", MOCK_PHASE_REPORT, {
        executeQueryFn: throwingFn,
      }),
    ).resolves.toBeUndefined();
  });
});
