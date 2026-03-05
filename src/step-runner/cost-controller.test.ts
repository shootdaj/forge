/**
 * Cost Controller Unit Tests
 *
 * Tests for CostController -- budget checking and cost tracking.
 *
 * Requirements tested: COST-01, COST-02, COST-03, COST-04
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CostController } from "./cost-controller.js";
import { BudgetExceededError } from "./types.js";
import type { CostData } from "../sdk/types.js";

function makeCostData(costUsd: number = 0.5): CostData {
  return {
    totalCostUsd: costUsd,
    numTurns: 5,
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    modelUsage: {},
    durationMs: 1000,
    durationApiMs: 800,
  };
}

describe("CostController", () => {
  let controller: CostController;

  beforeEach(() => {
    controller = new CostController();
  });

  // COST-02: Under budget passes
  it("TestCheckBudget_UnderBudget_Passes_COST02", () => {
    expect(() => controller.checkBudget(5.0, 200.0)).not.toThrow();
  });

  // COST-02: At budget throws
  it("TestCheckBudget_AtBudget_Throws_COST02", () => {
    expect(() => controller.checkBudget(200.0, 200.0)).toThrow(
      BudgetExceededError,
    );
  });

  // COST-02: Over budget throws
  it("TestCheckBudget_OverBudget_Throws_COST02", () => {
    expect(() => controller.checkBudget(250.0, 200.0)).toThrow(
      BudgetExceededError,
    );
  });

  // COST-02: BudgetExceededError contains correct values
  it("TestCheckBudget_ErrorValues_COST02", () => {
    try {
      controller.checkBudget(123.45, 100.0);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      if (err instanceof BudgetExceededError) {
        expect(err.totalBudgetUsed).toBe(123.45);
        expect(err.maxBudgetTotal).toBe(100.0);
        expect(err.message).toContain("123.45");
        expect(err.message).toContain("100.00");
      }
    }
  });

  // COST-03, COST-04: Record step cost updates log
  it("TestRecordStepCost_UpdatesLog_COST03", () => {
    controller.recordStepCost(
      "step-1",
      3,
      1.5,
      makeCostData(1.5),
      "verified",
      "sess-1",
    );

    expect(controller.size).toBe(1);
    const log = controller.getLog();
    expect(log[0].stepName).toBe("step-1");
    expect(log[0].phase).toBe(3);
    expect(log[0].costUsd).toBe(1.5);
    expect(log[0].status).toBe("verified");
    expect(log[0].sessionId).toBe("sess-1");
    expect(log[0].timestamp).toBeTruthy();
  });

  // COST-04: Cost accumulates across multiple entries
  it("TestRecordStepCost_AccumulatesTotal_COST04", () => {
    controller.recordStepCost(
      "step-1",
      1,
      1.0,
      makeCostData(1.0),
      "verified",
    );
    controller.recordStepCost(
      "step-2",
      1,
      2.5,
      makeCostData(2.5),
      "verified",
    );
    controller.recordStepCost(
      "step-3",
      2,
      0.75,
      makeCostData(0.75),
      "failed",
    );

    expect(controller.getTotal()).toBeCloseTo(4.25, 2);
    expect(controller.size).toBe(3);
  });

  // COST-04: Query cost by step name
  it("TestGetCostLog_QueryByStep_COST04", () => {
    controller.recordStepCost(
      "context",
      1,
      1.0,
      makeCostData(1.0),
      "verified",
    );
    controller.recordStepCost(
      "execute",
      1,
      3.0,
      makeCostData(3.0),
      "verified",
    );
    controller.recordStepCost(
      "context",
      2,
      1.5,
      makeCostData(1.5),
      "verified",
    );

    const contextEntries = controller.getCostByStep("context");
    expect(contextEntries).toHaveLength(2);
    expect(contextEntries[0].costUsd).toBe(1.0);
    expect(contextEntries[1].costUsd).toBe(1.5);
  });

  // COST-03: Query cost by phase
  it("TestGetCostLog_QueryByPhase_COST04", () => {
    controller.recordStepCost(
      "step-a",
      1,
      1.0,
      makeCostData(1.0),
      "verified",
    );
    controller.recordStepCost(
      "step-b",
      2,
      2.0,
      makeCostData(2.0),
      "verified",
    );
    controller.recordStepCost(
      "step-c",
      1,
      3.0,
      makeCostData(3.0),
      "failed",
    );

    const phase1Entries = controller.getCostByPhase(1);
    expect(phase1Entries).toHaveLength(2);
    expect(phase1Entries[0].stepName).toBe("step-a");
    expect(phase1Entries[1].stepName).toBe("step-c");
  });

  // COST-03: Phase total sums correctly
  it("TestGetPhaseTotal_SumsCorrectly_COST03", () => {
    controller.recordStepCost(
      "step-a",
      3,
      1.5,
      makeCostData(1.5),
      "verified",
    );
    controller.recordStepCost(
      "step-b",
      3,
      2.25,
      makeCostData(2.25),
      "verified",
    );
    controller.recordStepCost(
      "step-c",
      4,
      5.0,
      makeCostData(5.0),
      "verified",
    );

    expect(controller.getPhaseTotal(3)).toBeCloseTo(3.75, 2);
    expect(controller.getPhaseTotal(4)).toBeCloseTo(5.0, 2);
    expect(controller.getPhaseTotal(99)).toBe(0); // no entries for phase 99
  });

  // Cost log entries without phase
  it("TestRecordStepCost_NoPhase_COST04", () => {
    controller.recordStepCost(
      "orphan-step",
      undefined,
      0.5,
      makeCostData(0.5),
      "verified",
    );

    const entries = controller.getCostByStep("orphan-step");
    expect(entries).toHaveLength(1);
    expect(entries[0].phase).toBeUndefined();
  });

  // Cost log is a copy (immutable)
  it("TestGetLog_ReturnsCopy", () => {
    controller.recordStepCost(
      "step-1",
      1,
      1.0,
      makeCostData(1.0),
      "verified",
    );

    const log1 = controller.getLog();
    const log2 = controller.getLog();
    expect(log1).toEqual(log2);
    expect(log1).not.toBe(log2); // different array references
  });

  // Zero budget check (edge case)
  it("TestCheckBudget_ZeroBudgetLimit_Throws", () => {
    expect(() => controller.checkBudget(0.0, 0.0)).toThrow(
      BudgetExceededError,
    );
  });
});
