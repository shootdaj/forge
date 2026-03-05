/**
 * Human Checkpoint Tests
 *
 * Tests for checkpoint report generation, display formatting,
 * file writing, resume data loading, and checkpoint need detection.
 *
 * Requirements: PIPE-04
 */

import { describe, it, expect, vi } from "vitest";
import {
  generateCheckpointReport,
  formatCheckpointDisplay,
  writeCheckpointFile,
  loadResumeData,
  needsHumanCheckpoint,
} from "./human-checkpoint.js";
import type { ForgeState } from "../state/schema.js";
import type { CheckpointReport } from "./types.js";

/**
 * Create a minimal ForgeState for testing.
 */
function makeState(overrides: Partial<ForgeState> = {}): ForgeState {
  return {
    projectDir: "/test/project",
    startedAt: "2026-01-01T00:00:00Z",
    model: "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "wave_1",
    currentWave: 1,
    projectInitialized: true,
    scaffolded: true,
    phases: {},
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 0,
      verified: 0,
      gapHistory: [],
      roundsCompleted: 0,
    },
    remainingGaps: [],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 0,
    ...overrides,
  };
}

describe("generateCheckpointReport", () => {
  it("TestHumanCheckpoint_GenerateReport_WithServices", () => {
    const state = makeState({
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payment processing",
          signupUrl: "https://stripe.com",
          credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
          mockedIn: ["phase-3"],
        },
        {
          service: "sendgrid",
          why: "Email delivery",
          credentialsNeeded: ["SENDGRID_API_KEY"],
          mockedIn: ["phase-4"],
        },
      ],
      phases: {
        "1": { status: "completed", attempts: 1, budgetUsed: 5 },
        "2": { status: "completed", attempts: 1, budgetUsed: 3 },
        "3": { status: "failed", attempts: 2, budgetUsed: 10 },
      },
      specCompliance: {
        totalRequirements: 15,
        verified: 8,
        gapHistory: [],
        roundsCompleted: 0,
      },
    });

    const report = generateCheckpointReport(state);

    expect(report.servicesNeeded).toHaveLength(2);
    expect(report.servicesNeeded[0].service).toBe("stripe");
    expect(report.servicesNeeded[0].credentialsNeeded).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(report.servicesNeeded[1].service).toBe("sendgrid");
    expect(report.wave1Summary.phasesCompleted).toBe(2);
    expect(report.wave1Summary.phasesFailed).toBe(1);
    expect(report.wave1Summary.requirementsBuilt).toBe(8);
    expect(report.wave1Summary.requirementsTotal).toBe(15);
  });

  it("TestHumanCheckpoint_GenerateReport_WithSkippedItems", () => {
    const state = makeState({
      skippedItems: [
        {
          requirement: "REQ-05",
          phase: 3,
          attempts: [
            { approach: "Used REST API", error: "Rate limit hit" },
            { approach: "Used GraphQL", error: "Schema mismatch" },
          ],
          codeSoFar: "partial implementation",
        },
      ],
    });

    const report = generateCheckpointReport(state);

    expect(report.skippedItems).toHaveLength(1);
    expect(report.skippedItems[0].requirement).toBe("REQ-05");
    expect(report.skippedItems[0].attempts).toHaveLength(2);
    expect(report.skippedItems[0].codeSoFar).toBe("partial implementation");
  });

  it("TestHumanCheckpoint_GenerateReport_Empty", () => {
    const state = makeState();
    const report = generateCheckpointReport(state);

    expect(report.servicesNeeded).toHaveLength(0);
    expect(report.skippedItems).toHaveLength(0);
    expect(report.deferredIdeas).toHaveLength(0);
    expect(report.wave1Summary.phasesCompleted).toBe(0);
    expect(report.wave1Summary.phasesFailed).toBe(0);
    expect(report.wave1Summary.requirementsBuilt).toBe(0);
    expect(report.wave1Summary.requirementsTotal).toBe(0);
  });
});

describe("formatCheckpointDisplay", () => {
  it("TestHumanCheckpoint_FormatDisplay_FullReport", () => {
    const report: CheckpointReport = {
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payment processing",
          phase: 1,
          signupUrl: "https://stripe.com",
          credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        },
      ],
      skippedItems: [
        {
          requirement: "REQ-05",
          phase: 3,
          attempts: [
            { approach: "REST API", error: "Rate limit" },
            { approach: "GraphQL", error: "Schema mismatch" },
          ],
        },
      ],
      deferredIdeas: ["Add caching layer"],
      wave1Summary: {
        phasesCompleted: 4,
        phasesFailed: 1,
        requirementsBuilt: 8,
        requirementsTotal: 12,
      },
    };

    const output = formatCheckpointDisplay(report);

    expect(output).toContain("FORGE -- Human Checkpoint");
    expect(output).toContain("Wave 1 complete: 8/12 requirements built");
    expect(output).toContain("Services needed");
    expect(output).toContain("stripe: Payment processing");
    expect(output).toContain("https://stripe.com");
    expect(output).toContain("STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET");
    expect(output).toContain("Skipped items");
    expect(output).toContain("REQ-05");
    expect(output).toContain("REST API, GraphQL");
    expect(output).toContain("Deferred ideas");
    expect(output).toContain("Add caching layer");
    expect(output).toContain("forge resume --env .env.production");
  });

  it("TestHumanCheckpoint_FormatDisplay_NoSkipped", () => {
    const report: CheckpointReport = {
      servicesNeeded: [
        {
          service: "sendgrid",
          why: "Email",
          phase: 1,
          credentialsNeeded: ["SENDGRID_API_KEY"],
        },
      ],
      skippedItems: [],
      deferredIdeas: [],
      wave1Summary: {
        phasesCompleted: 5,
        phasesFailed: 0,
        requirementsBuilt: 10,
        requirementsTotal: 10,
      },
    };

    const output = formatCheckpointDisplay(report);

    expect(output).toContain("FORGE -- Human Checkpoint");
    expect(output).toContain("10/10 requirements built");
    expect(output).toContain("sendgrid: Email");
    expect(output).not.toContain("Skipped items");
    expect(output).not.toContain("Deferred ideas");
  });
});

describe("writeCheckpointFile", () => {
  it("TestHumanCheckpoint_WriteCheckpointFile", () => {
    const report: CheckpointReport = {
      servicesNeeded: [
        {
          service: "stripe",
          why: "payments",
          phase: 1,
          credentialsNeeded: ["STRIPE_KEY"],
        },
      ],
      skippedItems: [],
      deferredIdeas: [],
      wave1Summary: {
        phasesCompleted: 3,
        phasesFailed: 0,
        requirementsBuilt: 5,
        requirementsTotal: 8,
      },
    };

    const written: { path: string; data: string } = { path: "", data: "" };
    const mockFs = {
      writeFileSync: (path: string, data: string) => {
        written.path = path;
        written.data = data;
      },
    };

    writeCheckpointFile(report, "/tmp/forge-checkpoint.json", mockFs);

    expect(written.path).toBe("/tmp/forge-checkpoint.json");
    const parsed = JSON.parse(written.data);
    expect(parsed.servicesNeeded[0].service).toBe("stripe");
    expect(parsed.wave1Summary.phasesCompleted).toBe(3);
  });
});

describe("loadResumeData", () => {
  it("TestHumanCheckpoint_LoadResumeData_EnvFile", () => {
    const envContent = [
      "# Database config",
      "DB_HOST=localhost",
      'DB_PASS="my-secret"',
      "DB_PORT=5432",
      "",
      "# Stripe",
      "STRIPE_KEY='sk_test_123'",
      "  SPACES_KEY = value_with_spaces ",
    ].join("\n");

    const mockFs = {
      existsSync: (path: string) => path === "/tmp/.env.production",
      readFileSync: (_path: string, _enc: string) => envContent,
    };

    const result = loadResumeData("/tmp/.env.production", undefined, mockFs);

    expect(result.credentials.DB_HOST).toBe("localhost");
    expect(result.credentials.DB_PASS).toBe("my-secret");
    expect(result.credentials.DB_PORT).toBe("5432");
    expect(result.credentials.STRIPE_KEY).toBe("sk_test_123");
    expect(result.credentials.SPACES_KEY).toBe("value_with_spaces");
    expect(result.guidance).toEqual({});
  });

  it("TestHumanCheckpoint_LoadResumeData_WithGuidance", () => {
    const guidanceContent = [
      "## REQ-05",
      "Use the v2 API instead of v1.",
      "The endpoint is /api/v2/users.",
      "",
      "## REQ-08",
      "Skip the caching layer for now.",
      "Focus on correctness first.",
    ].join("\n");

    const mockFs = {
      existsSync: () => true,
      readFileSync: (path: string, _enc: string) => {
        if (path.includes("guidance")) return guidanceContent;
        return "API_KEY=test123\n";
      },
    };

    const result = loadResumeData("/tmp/.env", "/tmp/guidance.md", mockFs);

    expect(result.credentials.API_KEY).toBe("test123");
    expect(result.guidance["REQ-05"]).toContain("v2 API");
    expect(result.guidance["REQ-05"]).toContain("/api/v2/users");
    expect(result.guidance["REQ-08"]).toContain("Skip the caching layer");
  });

  it("TestHumanCheckpoint_LoadResumeData_MissingEnvThrows", () => {
    const mockFs = {
      existsSync: () => false,
      readFileSync: () => "",
    };

    expect(() => loadResumeData("/tmp/missing.env", undefined, mockFs)).toThrow(
      "Environment file not found",
    );
  });
});

describe("needsHumanCheckpoint", () => {
  it("TestHumanCheckpoint_NeedsCheckpoint_True", () => {
    const state = makeState({
      servicesNeeded: [
        {
          service: "stripe",
          why: "payments",
          credentialsNeeded: ["KEY"],
          mockedIn: [],
        },
      ],
    });

    expect(needsHumanCheckpoint(state)).toBe(true);
  });

  it("TestHumanCheckpoint_NeedsCheckpoint_TrueWithSkipped", () => {
    const state = makeState({
      skippedItems: [
        {
          requirement: "REQ-01",
          phase: 1,
          attempts: [{ approach: "try1", error: "failed" }],
        },
      ],
    });

    expect(needsHumanCheckpoint(state)).toBe(true);
  });

  it("TestHumanCheckpoint_NeedsCheckpoint_False", () => {
    const state = makeState();
    expect(needsHumanCheckpoint(state)).toBe(false);
  });
});
