/**
 * Deployment Types
 *
 * Type definitions for the deployment module. Covers deployment context,
 * results, health check outcomes, and the deploy-verify loop.
 */

import type { ForgeConfig } from "../config/schema.js";
import type { StateManager } from "../state/state-manager.js";
import type { StepRunnerContext } from "../step-runner/types.js";
import type { CostController } from "../step-runner/cost-controller.js";

/**
 * Deployment context — dependency injection container for deploy operations.
 */
export interface DeploymentContext {
  config: ForgeConfig;
  stateManager: StateManager;
  stepRunnerContext: StepRunnerContext;
  costController: CostController;
  /** Injectable exec function for running CLI commands */
  execFn?: (cmd: string) => string;
  /** Injectable runStep function */
  runStepFn?: (...args: any[]) => Promise<any>;
  /** Injectable fetch for health checks (defaults to global fetch) */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Override health check retry delay in ms (default 5000, use 1 for tests) */
  healthCheckRetryDelayMs?: number;
}

/**
 * Supported deployment targets.
 */
export type DeployTarget = "vercel" | "railway" | "fly" | "netlify" | "other";

/**
 * Result of a single health check attempt.
 */
export interface HealthCheckResult {
  /** Whether the health check passed */
  healthy: boolean;
  /** HTTP status code (0 if connection failed) */
  statusCode: number;
  /** Response time in ms */
  responseTimeMs: number;
  /** Error message if unhealthy */
  error?: string;
}

/**
 * Result of a single deployment attempt.
 */
export interface DeployAttempt {
  /** Attempt number (1-based) */
  attempt: number;
  /** Whether deploy + verify succeeded */
  success: boolean;
  /** Deployed URL (if deploy succeeded) */
  url?: string;
  /** Health check result (if deploy succeeded) */
  healthCheck?: HealthCheckResult;
  /** Error description if failed */
  error?: string;
  /** Cost of this attempt in USD */
  costUsd: number;
}

/**
 * Result of a single smoke test check.
 */
export interface SmokeTestCheck {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Result of post-deployment smoke testing.
 */
export interface SmokeTestResult {
  passed: boolean;
  tests: SmokeTestCheck[];
}

/**
 * Final deployment result.
 */
export type DeploymentResult =
  | {
      status: "deployed";
      url: string;
      attempts: DeployAttempt[];
      totalCostUsd: number;
      smokeTest?: SmokeTestResult;
    }
  | {
      status: "skipped";
      reason: string;
    }
  | {
      status: "failed";
      attempts: DeployAttempt[];
      totalCostUsd: number;
      reason: string;
    };
