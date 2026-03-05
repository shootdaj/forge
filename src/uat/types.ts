/**
 * UAT (User Acceptance Testing) Types
 *
 * Type definitions for the UAT runner that tests user workflows
 * end-to-end after spec compliance passes.
 *
 * Requirements: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
 */

import type { ForgeConfig } from "../config/schema.js";
import type { StateManager } from "../state/state-manager.js";
import type { StepRunnerContext } from "../step-runner/types.js";
import type { CostController } from "../step-runner/cost-controller.js";

/**
 * Application type determines the testing strategy.
 * - "web": headless browser testing (Playwright)
 * - "api": HTTP-based testing (curl/fetch)
 * - "cli": shell command testing (stdout/stderr/exit codes)
 *
 * Requirement: UAT-02
 */
export type AppType = "web" | "api" | "cli";

/**
 * A single user workflow extracted from REQUIREMENTS.md.
 * Each workflow maps to one or more acceptance criteria from a requirement.
 *
 * Requirement: UAT-01
 */
export interface UATWorkflow {
  /** Workflow ID in "UAT-R{N}-{index}" format */
  id: string;
  /** Source requirement ID (e.g., "R1") */
  requirementId: string;
  /** Human-readable description of the workflow */
  description: string;
  /** Acceptance criteria turned into ordered test steps */
  steps: string[];
  /** Application type determines testing strategy */
  appType: AppType;
}

/**
 * Result of testing a single workflow.
 *
 * Requirement: UAT-03
 */
export interface WorkflowResult {
  /** ID of the workflow that was tested */
  workflowId: string;
  /** Whether all steps passed */
  passed: boolean;
  /** Number of steps that passed */
  stepsPassed: number;
  /** Number of steps that failed */
  stepsFailed: number;
  /** Error messages from failed steps */
  errors: string[];
  /** Duration of the workflow test in milliseconds */
  durationMs: number;
}

/**
 * Aggregate result of the full UAT run.
 *
 * Requirement: UAT-05, UAT-06
 */
export interface UATResult {
  /** Overall status: "passed" if all pass, "failed" if some fail, "stuck" if gap closure exhausted */
  status: "passed" | "failed" | "stuck";
  /** Total number of workflows tested */
  workflowsTested: number;
  /** Number of workflows that passed */
  workflowsPassed: number;
  /** Number of workflows that failed */
  workflowsFailed: number;
  /** Per-workflow results */
  results: WorkflowResult[];
  /** Number of UAT attempts used (including retries) */
  attemptsUsed: number;
}

/**
 * Context object providing dependencies for UAT execution.
 * Injectable filesystem and exec function enable testing without real I/O.
 *
 * Requirement: UAT-01
 */
export interface UATContext {
  /** Project configuration */
  config: ForgeConfig;
  /** State manager instance */
  stateManager: StateManager;
  /** Step runner context for executing test steps */
  stepRunnerContext: StepRunnerContext;
  /** Cost controller for budget enforcement */
  costController: CostController;
  /** Injectable filesystem for testing */
  fs?: {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, content: string) => void;
    mkdirSync: (path: string, options?: { recursive: boolean }) => void;
  };
  /** Injectable shell exec for testing */
  execFn?: (cmd: string) => string;
}

/**
 * Safety guardrails configuration for UAT execution.
 * Prevents production credential usage during testing.
 *
 * Requirement: UAT-04
 */
export interface SafetyConfig {
  /** Whether to enforce sandbox-only credentials */
  useSandboxCredentials: boolean;
  /** Whether to use local SMTP capture (Mailhog/Mailtrap) */
  useLocalSmtp: boolean;
  /** Whether to use a test database from Docker */
  useTestDb: boolean;
  /** Environment file for test variables (e.g., ".env.test") */
  envFile: string;
}
