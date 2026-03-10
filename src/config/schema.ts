/**
 * Forge Config Schema
 *
 * Zod schema for forge.config.json with sensible defaults for all fields.
 * JSON uses snake_case; TypeScript maps to camelCase via the serialization layer.
 *
 * Requirements: CFG-01, CFG-02, CFG-03
 */

import { z } from "zod";

/**
 * Testing configuration schema.
 * Auto-configured during `forge init` based on detected stack.
 */
const TestingConfigSchema = z.object({
  stack: z.string().default("node"),
  unit_command: z.string().default("npm test -- --json"),
  integration_command: z
    .string()
    .default("npm run test:integration -- --json"),
  scenario_command: z.string().default("npm run test:e2e"),
  docker_compose_file: z.string().default("docker-compose.test.yml"),
});

/**
 * Verification toggle schema.
 * Controls which programmatic verifiers run after each step.
 */
const VerificationConfigSchema = z.object({
  files: z.boolean().default(true),
  tests: z.boolean().default(true),
  typecheck: z.boolean().default(true),
  lint: z.boolean().default(true),
  docker_smoke: z.boolean().default(false),
  test_coverage_check: z.boolean().default(true),
  observability_check: z.boolean().default(false),
  deployment: z.boolean().default(false),
});

/**
 * Notion integration schema.
 * Page IDs for targeted documentation updates.
 */
const NotionDocPagesSchema = z.object({
  architecture: z.string().default(""),
  data_flow: z.string().default(""),
  api_reference: z.string().default(""),
  component_index: z.string().default(""),
  adrs: z.string().default(""),
  deployment: z.string().default(""),
  dev_workflow: z.string().default(""),
  phase_reports: z.string().default(""),
});

const NotionConfigSchema = z.object({
  parent_page_id: z.string().default(""),
  doc_pages: z.any().default({}).pipe(NotionDocPagesSchema),
});

/**
 * Parallelism configuration schema.
 */
const ParallelismConfigSchema = z.object({
  max_concurrent_phases: z.number().int().min(1).default(3),
  enable_subagents: z.boolean().default(true),
  background_docs: z.boolean().default(true),
});

/**
 * Frontend design configuration schema.
 * Controls whether Forge pauses to let the user choose a design direction.
 */
const FrontendConfigSchema = z.object({
  has_gui: z.boolean().default(false),
  design_interactive: z.boolean().default(true),
  design_options_count: z.number().int().min(2).max(6).default(3),
});

/**
 * Deployment configuration schema.
 */
const DeploymentConfigSchema = z.object({
  target: z.string().default("vercel"),
  environments: z
    .array(z.string())
    .default(["development", "staging", "production"]),
});

/**
 * Notification configuration schema.
 */
const NotificationsConfigSchema = z.object({
  on_human_needed: z.string().default("stdout"),
  on_phase_complete: z.string().default("stdout"),
  on_failure: z.string().default("stdout"),
});

/**
 * Root config schema for forge.config.json.
 *
 * All fields have sensible defaults so even an empty `{}` config is valid.
 * Uses z.any().default({}).pipe() pattern to ensure nested defaults propagate
 * correctly in Zod 4.
 *
 * Requirements: CFG-01, CFG-02, CFG-03
 */
export const ForgeConfigSchema = z.object({
  model: z.string().default("claude-opus-4-6"),
  max_budget_total: z.number().min(0).default(200.0),
  max_budget_per_step: z.number().min(0).default(15.0),
  max_retries: z.number().int().min(0).default(3),
  max_compliance_rounds: z.number().int().min(0).default(5),
  max_turns_per_step: z.number().int().min(1).default(200),
  testing: z.any().default({}).pipe(TestingConfigSchema),
  verification: z.any().default({}).pipe(VerificationConfigSchema),
  notion: z.any().default({}).pipe(NotionConfigSchema),
  parallelism: z.any().default({}).pipe(ParallelismConfigSchema),
  frontend: z.any().default({}).pipe(FrontendConfigSchema),
  deployment: z.any().default({}).pipe(DeploymentConfigSchema),
  notifications: z.any().default({}).pipe(NotificationsConfigSchema),
});

/**
 * The raw JSON shape (snake_case keys).
 */
export type ForgeConfigRaw = z.infer<typeof ForgeConfigSchema>;

/**
 * The camelCase TypeScript interface for config.
 * Mapped from snake_case JSON via the serialization layer.
 */
export interface ForgeConfig {
  model: string;
  maxBudgetTotal: number;
  maxBudgetPerStep: number;
  maxRetries: number;
  maxComplianceRounds: number;
  maxTurnsPerStep: number;
  testing: {
    stack: string;
    unitCommand: string;
    integrationCommand: string;
    scenarioCommand: string;
    dockerComposeFile: string;
  };
  verification: {
    files: boolean;
    tests: boolean;
    typecheck: boolean;
    lint: boolean;
    dockerSmoke: boolean;
    testCoverageCheck: boolean;
    observabilityCheck: boolean;
    deployment: boolean;
  };
  notion: {
    parentPageId: string;
    docPages: {
      architecture: string;
      dataFlow: string;
      apiReference: string;
      componentIndex: string;
      adrs: string;
      deployment: string;
      devWorkflow: string;
      phaseReports: string;
    };
  };
  parallelism: {
    maxConcurrentPhases: number;
    enableSubagents: boolean;
    backgroundDocs: boolean;
  };
  frontend: {
    hasGui: boolean;
    designInteractive: boolean;
    designOptionsCount: number;
  };
  deployment: {
    target: string;
    environments: string[];
  };
  notifications: {
    onHumanNeeded: string;
    onPhaseComplete: string;
    onFailure: string;
  };
}
