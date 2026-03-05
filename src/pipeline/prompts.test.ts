/**
 * Pipeline Prompt Builder Tests
 *
 * Tests for all prompt builder pure functions.
 *
 * Requirements: PIPE-04, PIPE-07, PIPE-08
 */

import { describe, it, expect } from "vitest";
import {
  buildNewProjectPrompt,
  buildScaffoldPrompt,
  buildIntegrationPrompt,
  buildSkippedItemPrompt,
  buildComplianceGapPrompt,
} from "./prompts.js";
import type { ForgeState } from "../state/schema.js";
import type { ServiceDetection } from "./types.js";

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

describe("buildNewProjectPrompt", () => {
  it("TestPrompts_NewProject", () => {
    const requirements =
      "R1: User login\nR2: Dashboard\nR3: API endpoints";
    const prompt = buildNewProjectPrompt(requirements);

    expect(prompt).toContain("/gsd:new-project");
    expect(prompt).toContain(requirements);
    expect(prompt).toContain("ROADMAP.md");
    expect(prompt).toContain("PROJECT.md");
    expect(prompt).toContain("requirement ID");
  });
});

describe("buildScaffoldPrompt", () => {
  it("TestPrompts_Scaffold", () => {
    const state = makeState({
      phases: {
        "1": { status: "completed", attempts: 1, budgetUsed: 5 },
        "2": { status: "in_progress", attempts: 1, budgetUsed: 2 },
      },
    });

    const prompt = buildScaffoldPrompt(state);

    expect(prompt).toContain("CI");
    expect(prompt).toContain("Docker");
    expect(prompt).toContain("observability");
    expect(prompt).toContain("health");
    expect(prompt).toContain("Phase 1: completed");
    expect(prompt).toContain("Phase 2: in_progress");
  });

  it("TestPrompts_Scaffold_NoPhases", () => {
    const state = makeState();
    const prompt = buildScaffoldPrompt(state);

    expect(prompt).toContain("no phases tracked yet");
  });
});

describe("buildIntegrationPrompt", () => {
  it("TestPrompts_Integration", () => {
    const services: ServiceDetection[] = [
      {
        service: "stripe",
        why: "Payment processing",
        phase: 3,
        signupUrl: "https://stripe.com",
        credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      },
      {
        service: "sendgrid",
        why: "Email delivery",
        phase: 4,
        credentialsNeeded: ["SENDGRID_API_KEY"],
      },
    ];

    const credentials = {
      STRIPE_SECRET_KEY: "sk_test_123",
      SENDGRID_API_KEY: "SG.abc",
    };

    const prompt = buildIntegrationPrompt(services, credentials);

    expect(prompt).toContain("stripe");
    expect(prompt).toContain("sendgrid");
    expect(prompt).toContain("Payment processing");
    expect(prompt).toContain("Email delivery");
    expect(prompt).toContain("STRIPE_SECRET_KEY: provided");
    expect(prompt).toContain("STRIPE_WEBHOOK_SECRET: MISSING");
    expect(prompt).toContain("SENDGRID_API_KEY: provided");
    expect(prompt).toContain("https://stripe.com");
    expect(prompt).toContain("FORGE:MOCK");
    expect(prompt).toContain("integration tests");
    expect(prompt).toContain("STRIPE_SECRET_KEY, SENDGRID_API_KEY");
  });

  it("TestPrompts_Integration_NoCreds", () => {
    const services: ServiceDetection[] = [
      {
        service: "redis",
        why: "Caching",
        phase: 2,
        credentialsNeeded: ["REDIS_URL"],
      },
    ];

    const prompt = buildIntegrationPrompt(services, {});

    expect(prompt).toContain("redis");
    expect(prompt).toContain("REDIS_URL: MISSING");
    expect(prompt).toContain("(none)");
  });
});

describe("buildSkippedItemPrompt", () => {
  it("TestPrompts_SkippedItem", () => {
    const item = {
      requirement: "REQ-05",
      phase: 3,
      attempts: [
        { approach: "REST API v1", error: "Rate limit exceeded" },
        { approach: "GraphQL query", error: "Schema mismatch" },
      ],
      codeSoFar: "const api = new RestClient();",
    };

    const guidance = "Use the v2 REST API with pagination.";

    const prompt = buildSkippedItemPrompt(item, guidance);

    expect(prompt).toContain("REQ-05");
    expect(prompt).toContain("phase 3");
    expect(prompt).toContain("REST API v1");
    expect(prompt).toContain("Rate limit exceeded");
    expect(prompt).toContain("GraphQL query");
    expect(prompt).toContain("Schema mismatch");
    expect(prompt).toContain("const api = new RestClient()");
    expect(prompt).toContain("v2 REST API with pagination");
    expect(prompt).toContain("user's guidance");
  });

  it("TestPrompts_SkippedItem_NoAttempts", () => {
    const item = {
      requirement: "REQ-10",
      phase: 5,
      attempts: [],
    };

    const prompt = buildSkippedItemPrompt(item, "Just implement it simply.");

    expect(prompt).toContain("REQ-10");
    expect(prompt).toContain("no prior attempts");
    expect(prompt).toContain("Just implement it simply");
    expect(prompt).not.toContain("Existing partial code");
  });
});

describe("buildComplianceGapPrompt", () => {
  it("TestPrompts_ComplianceGap", () => {
    const prompt = buildComplianceGapPrompt(
      "AUTH-03",
      "Missing refresh token rotation on /api/auth/refresh endpoint",
      2,
    );

    expect(prompt).toContain("AUTH-03");
    expect(prompt).toContain("round 2");
    expect(prompt).toContain("refresh token rotation");
    expect(prompt).toContain("/api/auth/refresh");
    expect(prompt).toContain("targeted code changes");
    expect(prompt).toContain("compliance round 2");
    expect(prompt).toContain("different approach");
  });

  it("TestPrompts_ComplianceGap_Round1", () => {
    const prompt = buildComplianceGapPrompt(
      "DATA-01",
      "No database migration for users table",
      1,
    );

    expect(prompt).toContain("DATA-01");
    expect(prompt).toContain("round 1");
    expect(prompt).toContain("database migration");
    expect(prompt).toContain("compliance round 1");
  });
});
