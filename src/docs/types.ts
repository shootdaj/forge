/**
 * Forge Notion Documentation Types
 *
 * Type definitions for Notion page management, phase reports,
 * ADR records, and milestone summaries.
 *
 * Requirements: DOC-01, DOC-02, DOC-03, DOC-04
 */

/**
 * IDs for the 8 mandatory Notion documentation pages.
 * Stored in config.notion.docPages after initial creation.
 */
export interface NotionPageIds {
  architecture: string;
  dataFlow: string;
  apiReference: string;
  componentIndex: string;
  adrs: string;
  deployment: string;
  devWorkflow: string;
  phaseReports: string;
}

/**
 * The 8 mandatory page names used for creation prompts.
 * Order matches NotionPageIds keys.
 */
export const MANDATORY_PAGES = [
  "Architecture",
  "Data Flow",
  "API Reference",
  "Component Index",
  "ADRs",
  "Deployment",
  "Dev Workflow",
  "Phase Reports",
] as const;

/**
 * Maps MANDATORY_PAGES display names to NotionPageIds keys.
 */
export const PAGE_NAME_TO_KEY: Record<
  (typeof MANDATORY_PAGES)[number],
  keyof NotionPageIds
> = {
  Architecture: "architecture",
  "Data Flow": "dataFlow",
  "API Reference": "apiReference",
  "Component Index": "componentIndex",
  ADRs: "adrs",
  Deployment: "deployment",
  "Dev Workflow": "devWorkflow",
  "Phase Reports": "phaseReports",
};

/**
 * Phase report data used for per-phase Notion updates.
 *
 * Requirement: DOC-02
 */
export interface PhaseReport {
  phaseNumber: number;
  phaseName: string;
  goals: string;
  testResults: { passed: number; failed: number; total: number };
  architectureChanges: string[];
  issues: string[];
  budgetUsed: number;
}

/**
 * Architecture Decision Record for Notion ADR pages.
 *
 * Requirement: DOC-03
 */
export interface ADRRecord {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: "accepted" | "superseded" | "deprecated";
}

/**
 * Milestone summary data for final documentation publishing.
 *
 * Requirement: DOC-04
 */
export interface MilestoneSummary {
  totalPhases: number;
  totalTests: number;
  totalBudget: number;
  requirements: { total: number; verified: number };
  highlights: string[];
}

/**
 * Injectable executeQuery function type for testing.
 * Matches a simplified version of Forge's executeQuery signature.
 */
export type ExecuteQueryFn = (options: {
  prompt: string;
  model?: string;
  outputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}) => Promise<{
  ok: boolean;
  result?: string;
  structuredOutput?: unknown;
  error?: { message: string };
}>;
