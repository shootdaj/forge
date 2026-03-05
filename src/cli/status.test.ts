/**
 * Status Formatter Unit Tests
 *
 * Tests for pure formatting functions that produce terminal-friendly
 * plain text status output from ForgeState.
 *
 * Requirements: CLI-04, COST-05
 */

import { describe, it, expect } from "vitest";
import type { ForgeState } from "../state/schema.js";
import {
  formatStatus,
  formatPhaseTable,
  formatBudgetBreakdown,
  formatServicesNeeded,
  formatSkippedItems,
  formatSpecCompliance,
} from "./status.js";

/**
 * Factory function returning a complete ForgeState with sensible defaults.
 */
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
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1.2 },
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
    },
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 20,
      verified: 15,
      gapHistory: [5, 3],
      roundsCompleted: 3,
    },
    remainingGaps: ["R7", "R12", "R15", "R18", "R20"],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    totalBudgetUsed: 3.7,
    ...overrides,
  };
}

describe("formatStatus", () => {
  it("produces correct output for a state with all sections populated", () => {
    const state = createTestState({
      servicesNeeded: [
        {
          service: "stripe",
          why: "Payment processing",
          credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
          mockedIn: [],
        },
        {
          service: "sendgrid",
          why: "Email delivery",
          credentialsNeeded: ["SENDGRID_API_KEY"],
          mockedIn: [],
        },
      ],
      skippedItems: [
        {
          requirement: "R7",
          phase: 3,
          attempts: [
            { approach: "websocket", error: "failed" },
            { approach: "sse", error: "failed" },
          ],
        },
        {
          requirement: "R12",
          phase: 5,
          attempts: [{ approach: "puppeteer", error: "failed" }],
        },
      ],
    });

    const output = formatStatus(state, 200);

    // Header
    expect(output).toContain("FORGE -- Project Status");
    expect(output).toContain("Status: wave_1 | Wave: 1");

    // Phase Progress
    expect(output).toContain("Phase Progress:");
    expect(output).toContain("Phase 1:");
    expect(output).toContain("Phase 2:");
    expect(output).toContain("Phase 3:");

    // Services Needed
    expect(output).toContain("Services Needed:");
    expect(output).toContain("stripe: Payment processing");
    expect(output).toContain("STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET");
    expect(output).toContain("sendgrid: Email delivery");
    expect(output).toContain("SENDGRID_API_KEY");

    // Skipped Items
    expect(output).toContain("Skipped Items:");
    expect(output).toContain("R7 (phase 3): Tried websocket, sse");
    expect(output).toContain("R12 (phase 5): Tried puppeteer");

    // Spec Compliance
    expect(output).toContain("Spec Compliance: 15/20 requirements verified (3 rounds)");
    expect(output).toContain("Remaining: R7, R12, R15, R18, R20");

    // Budget
    expect(output).toContain("Budget:");
    expect(output).toContain("$3.70 / $200.00");
  });

  it("omits services and skipped sections when empty", () => {
    const state = createTestState();
    const output = formatStatus(state);

    expect(output).toContain("FORGE -- Project Status");
    expect(output).toContain("Phase Progress:");
    expect(output).toContain("Spec Compliance:");
    expect(output).toContain("Budget:");

    // Should NOT contain optional sections
    expect(output).not.toContain("Services Needed:");
    expect(output).not.toContain("Skipped Items:");
  });

  it("defaults maxBudgetTotal to 200 when not provided", () => {
    const state = createTestState();
    const output = formatStatus(state);
    expect(output).toContain("$200.00");
  });
});

describe("formatPhaseTable", () => {
  it("sorts phases numerically", () => {
    const phases: ForgeState["phases"] = {
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
      "10": { status: "pending", attempts: 0, budgetUsed: 0 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1.2 },
    };

    const output = formatPhaseTable(phases);
    const lines = output.split("\n").filter((l) => /Phase \d+:/.test(l));

    // Verify order: 1, 2, 3, 10
    expect(lines[0]).toContain("Phase 1:");
    expect(lines[1]).toContain("Phase 2:");
    expect(lines[2]).toContain("Phase 3:");
    expect(lines[3]).toContain("Phase 10:");
  });

  it("handles empty phases", () => {
    const output = formatPhaseTable({});
    expect(output).toContain("No phases configured.");
  });

  it("aligns statuses with padding", () => {
    const phases: ForgeState["phases"] = {
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1.2 },
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
    };

    const output = formatPhaseTable(phases);
    // "in_progress" is the longest (11 chars), others should be padded
    expect(output).toContain("completed  ");
    expect(output).toContain("in_progress");
    expect(output).toContain("pending    ");
  });
});

describe("formatBudgetBreakdown", () => {
  it("shows per-phase costs and total", () => {
    const phases: ForgeState["phases"] = {
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
      "2": { status: "in_progress", attempts: 1, budgetUsed: 1.2 },
      "3": { status: "pending", attempts: 0, budgetUsed: 0 },
    };

    const output = formatBudgetBreakdown(phases, 3.7, 200);

    expect(output).toContain("Budget:");
    expect(output).toContain("$2.50");
    expect(output).toContain("$1.20");
    expect(output).toContain("$0.00");
    expect(output).toContain("$3.70 / $200.00");
  });

  it("aligns dollar amounts", () => {
    const phases: ForgeState["phases"] = {
      "1": { status: "completed", attempts: 1, budgetUsed: 100.5 },
      "2": { status: "pending", attempts: 0, budgetUsed: 2.5 },
    };

    const output = formatBudgetBreakdown(phases, 103, 200);
    const lines = output.split("\n");

    // Both dollar amounts should be right-aligned
    const phase1Line = lines.find((l) => l.includes("Phase 1:"));
    const phase2Line = lines.find((l) => l.includes("Phase 2:"));

    expect(phase1Line).toBeDefined();
    expect(phase2Line).toBeDefined();

    // $100.50 is 7 chars, $2.50 is 5 chars -- $2.50 should be padded
    // Both should end at the same position
    const dollarIndex1 = phase1Line!.indexOf("$");
    const dollarIndex2 = phase2Line!.indexOf("$");
    // The dollar sign positions may differ due to padding, but the numbers should end at same column
    const endIndex1 = phase1Line!.length;
    const endIndex2 = phase2Line!.length;
    expect(endIndex1).toBe(endIndex2);
  });

  it("contains a separator line between phases and total", () => {
    const phases: ForgeState["phases"] = {
      "1": { status: "completed", attempts: 1, budgetUsed: 2.5 },
    };

    const output = formatBudgetBreakdown(phases, 2.5, 200);
    expect(output).toContain("---");
  });
});

describe("formatSpecCompliance", () => {
  it("shows remaining gaps", () => {
    const compliance = {
      totalRequirements: 20,
      verified: 15,
      gapHistory: [5, 3],
      roundsCompleted: 3,
    };

    const output = formatSpecCompliance(compliance, ["R7", "R12"]);

    expect(output).toContain("15/20 requirements verified (3 rounds)");
    expect(output).toContain("Remaining: R7, R12");
  });

  it("omits remaining line when no gaps", () => {
    const compliance = {
      totalRequirements: 10,
      verified: 10,
      gapHistory: [],
      roundsCompleted: 1,
    };

    const output = formatSpecCompliance(compliance, []);

    expect(output).toContain("10/10 requirements verified (1 rounds)");
    expect(output).not.toContain("Remaining:");
  });
});

describe("formatServicesNeeded", () => {
  it("lists credentials for each service", () => {
    const services: ForgeState["servicesNeeded"] = [
      {
        service: "stripe",
        why: "Payment processing",
        credentialsNeeded: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        mockedIn: [],
      },
    ];

    const output = formatServicesNeeded(services);

    expect(output).toContain("Services Needed:");
    expect(output).toContain("stripe: Payment processing (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)");
  });

  it("returns empty string when no services", () => {
    expect(formatServicesNeeded([])).toBe("");
  });
});

describe("formatSkippedItems", () => {
  it("lists attempts for each skipped item", () => {
    const items: ForgeState["skippedItems"] = [
      {
        requirement: "R7",
        phase: 3,
        attempts: [
          { approach: "websocket", error: "failed" },
          { approach: "sse", error: "timeout" },
        ],
      },
    ];

    const output = formatSkippedItems(items);

    expect(output).toContain("Skipped Items:");
    expect(output).toContain("R7 (phase 3): Tried websocket, sse");
  });

  it("returns empty string when no items", () => {
    expect(formatSkippedItems([])).toBe("");
  });
});
