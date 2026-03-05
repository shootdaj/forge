/**
 * Forge State Schema
 *
 * Zod schema for forge-state.json with all fields from SPEC.md.
 * JSON uses snake_case; TypeScript maps to camelCase via serialization layer.
 *
 * Requirements: STA-01, STA-02, STA-03
 */

import { z } from "zod";

/**
 * Phase test results.
 */
const TestResultsSchema = z.object({
  passed: z.number().int().default(0),
  failed: z.number().int().default(0),
  total: z.number().int().default(0),
});

/**
 * Per-phase status tracking.
 */
const PhaseStateSchema = z.object({
  status: z.enum([
    "pending",
    "in_progress",
    "completed",
    "partial",
    "skipped",
    "failed",
  ]),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  attempts: z.number().int().default(0),
  test_results: TestResultsSchema.optional(),
  mocked_service_names: z.array(z.string()).optional(),
  budget_used: z.number().default(0),
});

/**
 * External service needed for the project.
 */
const ServiceNeededSchema = z.object({
  service: z.string(),
  why: z.string(),
  signup_url: z.string().optional(),
  credentials_needed: z.array(z.string()).default([]),
  mocked_in: z.array(z.string()).default([]),
});

/**
 * Mock registry entry — tracks file-level mock details.
 */
const MockRegistryEntrySchema = z.object({
  interface: z.string(),
  mock: z.string(),
  real: z.string(),
  factory: z.string(),
  test_fixtures: z.array(z.string()).default([]),
  env_vars: z.array(z.string()).default([]),
});

/**
 * Skipped item — records what was tried and why it failed.
 */
const SkippedItemAttemptSchema = z.object({
  approach: z.string(),
  error: z.string(),
});

const SkippedItemSchema = z.object({
  requirement: z.string(),
  phase: z.number().int(),
  attempts: z.array(SkippedItemAttemptSchema).default([]),
  code_so_far: z.string().optional(),
});

/**
 * Spec compliance tracking.
 */
const SpecComplianceSchema = z.object({
  total_requirements: z.number().int().default(0),
  verified: z.number().int().default(0),
  gap_history: z.array(z.number()).default([]),
  rounds_completed: z.number().int().default(0),
});

/**
 * UAT (User Acceptance Testing) results.
 */
const UatResultsSchema = z.object({
  status: z
    .enum(["not_started", "in_progress", "passed", "failed"])
    .default("not_started"),
  workflows_tested: z.number().int().default(0),
  workflows_passed: z.number().int().default(0),
  workflows_failed: z.number().int().default(0),
});

/**
 * Root state schema for forge-state.json.
 *
 * Tracks all orchestrator state as defined in SPEC.md.
 *
 * Requirements: STA-01, STA-03
 */
export const ForgeStateSchema = z.object({
  project_dir: z.string(),
  started_at: z.string(),
  model: z.string().default("claude-opus-4-6"),
  requirements_doc: z.string().default("REQUIREMENTS.md"),
  status: z
    .enum([
      "initializing",
      "wave_1",
      "human_checkpoint",
      "wave_2",
      "wave_3",
      "uat",
      "completed",
      "failed",
    ])
    .default("initializing"),
  current_wave: z.number().int().default(1),
  project_initialized: z.boolean().default(false),
  scaffolded: z.boolean().default(false),
  phases: z.record(z.string(), PhaseStateSchema).default({}),
  services_needed: z.array(ServiceNeededSchema).default([]),
  mock_registry: z.record(z.string(), MockRegistryEntrySchema).default({}),
  skipped_items: z.array(SkippedItemSchema).default([]),
  credentials: z.record(z.string(), z.string()).default({}),
  human_guidance: z.record(z.string(), z.string()).default({}),
  spec_compliance: z.any().default({}).pipe(SpecComplianceSchema),
  remaining_gaps: z.array(z.string()).default([]),
  uat_results: z.any().default({}).pipe(UatResultsSchema),
  total_budget_used: z.number().default(0),
});

/**
 * The raw JSON shape (snake_case keys).
 */
export type ForgeStateRaw = z.infer<typeof ForgeStateSchema>;

/**
 * Phase status enum for type-safe status checks.
 */
export type PhaseStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "partial"
  | "skipped"
  | "failed";

/**
 * Orchestrator status enum.
 */
export type OrchestratorStatus =
  | "initializing"
  | "wave_1"
  | "human_checkpoint"
  | "wave_2"
  | "wave_3"
  | "uat"
  | "completed"
  | "failed";

/**
 * The camelCase TypeScript interface for state.
 * Mapped from snake_case JSON via the serialization layer.
 */
export interface ForgeState {
  projectDir: string;
  startedAt: string;
  model: string;
  requirementsDoc: string;
  status: OrchestratorStatus;
  currentWave: number;
  projectInitialized: boolean;
  scaffolded: boolean;
  phases: Record<
    string,
    {
      status: PhaseStatus;
      startedAt?: string;
      completedAt?: string;
      attempts: number;
      testResults?: {
        passed: number;
        failed: number;
        total: number;
      };
      mockedServiceNames?: string[];
      budgetUsed: number;
    }
  >;
  servicesNeeded: Array<{
    service: string;
    why: string;
    signupUrl?: string;
    credentialsNeeded: string[];
    mockedIn: string[];
  }>;
  mockRegistry: Record<
    string,
    {
      interface: string;
      mock: string;
      real: string;
      factory: string;
      testFixtures: string[];
      envVars: string[];
    }
  >;
  skippedItems: Array<{
    requirement: string;
    phase: number;
    attempts: Array<{
      approach: string;
      error: string;
    }>;
    codeSoFar?: string;
  }>;
  credentials: Record<string, string>;
  humanGuidance: Record<string, string>;
  specCompliance: {
    totalRequirements: number;
    verified: number;
    gapHistory: number[];
    roundsCompleted: number;
  };
  remainingGaps: string[];
  uatResults: {
    status: "not_started" | "in_progress" | "passed" | "failed";
    workflowsTested: number;
    workflowsPassed: number;
    workflowsFailed: number;
  };
  totalBudgetUsed: number;
}
