/**
 * Cost Controller
 *
 * Tracks per-step, per-phase, and project-level costs.
 * Enforces budget limits before step execution.
 *
 * Requirements: COST-01, COST-02, COST-03, COST-04
 */

import type { CostData } from "../sdk/types.js";
import type { CostLogEntry } from "./types.js";
import type { StepResult } from "./types.js";
import { BudgetExceededError } from "./types.js";

/**
 * CostController maintains an in-memory cost log and provides
 * budget checking and cost querying capabilities.
 *
 * Cost is recorded per step and queryable by step name or phase.
 * The project total budget is checked before each step starts.
 *
 * Requirements: COST-01, COST-02, COST-03, COST-04
 */
export class CostController {
  private readonly _log: CostLogEntry[] = [];

  /**
   * Check whether the project budget allows starting a new step.
   *
   * Throws BudgetExceededError if totalBudgetUsed >= maxBudgetTotal.
   * This is a hard stop -- the step must not start.
   *
   * Requirement: COST-02
   *
   * @param totalBudgetUsed - Current cumulative budget used
   * @param maxBudgetTotal - Maximum project budget
   */
  checkBudget(totalBudgetUsed: number, maxBudgetTotal: number): void {
    if (totalBudgetUsed >= maxBudgetTotal) {
      throw new BudgetExceededError(totalBudgetUsed, maxBudgetTotal);
    }
  }

  /**
   * Record a step's cost in the log.
   *
   * Requirement: COST-04
   *
   * @param stepName - Name of the step
   * @param phase - Phase number (optional)
   * @param costUsd - Cost in USD
   * @param costData - Full cost data from SDK
   * @param status - Step outcome status
   * @param sessionId - SDK session ID for debugging
   */
  recordStepCost(
    stepName: string,
    phase: number | undefined,
    costUsd: number,
    costData: CostData,
    status: StepResult["status"],
    sessionId?: string,
  ): void {
    this._log.push({
      stepName,
      phase,
      costUsd,
      costData,
      timestamp: new Date().toISOString(),
      status,
      sessionId,
    });
  }

  /**
   * Get cost log entries filtered by step name.
   *
   * Requirement: COST-04
   */
  getCostByStep(stepName: string): CostLogEntry[] {
    return this._log.filter((entry) => entry.stepName === stepName);
  }

  /**
   * Get cost log entries filtered by phase.
   *
   * Requirement: COST-03
   */
  getCostByPhase(phase: number): CostLogEntry[] {
    return this._log.filter((entry) => entry.phase === phase);
  }

  /**
   * Get the total cost for a phase.
   *
   * Requirement: COST-03
   */
  getPhaseTotal(phase: number): number {
    return this.getCostByPhase(phase).reduce(
      (sum, entry) => sum + entry.costUsd,
      0,
    );
  }

  /**
   * Get the total cost across all logged steps.
   */
  getTotal(): number {
    return this._log.reduce((sum, entry) => sum + entry.costUsd, 0);
  }

  /**
   * Get the full cost log.
   *
   * Requirement: COST-04
   */
  getLog(): ReadonlyArray<CostLogEntry> {
    return [...this._log];
  }

  /**
   * Get the number of entries in the log.
   */
  get size(): number {
    return this._log.length;
  }
}
