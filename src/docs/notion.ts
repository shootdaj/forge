/**
 * Forge Notion Documentation Module
 *
 * Manages Notion page lifecycle: creation of 8 mandatory pages during init,
 * per-phase updates, ADR creation, phase reports, and final milestone docs.
 *
 * All functions accept an injectable executeQueryFn for testability.
 * Each function builds a prompt for the agent that uses Notion MCP tools.
 *
 * Requirements: DOC-01, DOC-02, DOC-03, DOC-04
 */

import type {
  NotionPageIds,
  PhaseReport,
  ADRRecord,
  MilestoneSummary,
  ExecuteQueryFn,
} from "./types.js";
import { MANDATORY_PAGES, PAGE_NAME_TO_KEY } from "./types.js";

/**
 * JSON schema for structured output extraction of page IDs from createDocPages.
 */
const PAGE_IDS_SCHEMA = {
  type: "object",
  properties: {
    architecture: { type: "string", description: "Architecture page ID" },
    dataFlow: { type: "string", description: "Data Flow page ID" },
    apiReference: { type: "string", description: "API Reference page ID" },
    componentIndex: {
      type: "string",
      description: "Component Index page ID",
    },
    adrs: { type: "string", description: "ADRs page ID" },
    deployment: { type: "string", description: "Deployment page ID" },
    devWorkflow: { type: "string", description: "Dev Workflow page ID" },
    phaseReports: { type: "string", description: "Phase Reports page ID" },
  },
  required: [
    "architecture",
    "dataFlow",
    "apiReference",
    "componentIndex",
    "adrs",
    "deployment",
    "devWorkflow",
    "phaseReports",
  ],
  additionalProperties: false,
};

/**
 * Create the 8 mandatory documentation pages under a Notion parent page.
 *
 * Builds a prompt instructing the agent to create child pages using
 * the Notion MCP `notion_create_page` tool. Uses outputSchema to
 * extract structured NotionPageIds.
 *
 * Requirement: DOC-01
 *
 * @param parentPageId - The Notion parent page ID
 * @param projectName - The project name for page titles
 * @param options - Optional executeQueryFn and model overrides
 * @returns NotionPageIds with IDs for all 8 created pages
 * @throws Error if SDK query fails or structured output is missing
 */
export async function createDocPages(
  parentPageId: string,
  projectName: string,
  options?: { executeQueryFn?: ExecuteQueryFn; model?: string },
): Promise<NotionPageIds> {
  const executeQueryFn = options?.executeQueryFn;
  if (!executeQueryFn) {
    throw new Error(
      "createDocPages requires an executeQueryFn (no default SDK integration)",
    );
  }

  const pageList = MANDATORY_PAGES.map((name, i) => `${i + 1}. ${name}`).join(
    "\n",
  );

  const prompt = `Create 8 child pages under the Notion parent page with ID "${parentPageId}" for the project "${projectName}".

Use the notion_create_page tool to create each of these pages:
${pageList}

Each page should have:
- Title: "${projectName} - {Page Name}" (e.g., "${projectName} - Architecture")
- A brief placeholder description explaining the page's purpose

After creating all 8 pages, return their IDs in the structured output with these keys:
architecture, dataFlow, apiReference, componentIndex, adrs, deployment, devWorkflow, phaseReports`;

  const result = await executeQueryFn({
    prompt,
    model: options?.model,
    outputSchema: PAGE_IDS_SCHEMA,
  });

  if (!result.ok) {
    throw new Error(
      `Failed to create Notion doc pages: ${result.error?.message ?? "Unknown error"}`,
    );
  }

  const pageIds = result.structuredOutput as NotionPageIds | undefined;
  if (!pageIds) {
    throw new Error(
      "createDocPages: No structured output returned from agent query",
    );
  }

  // Validate all 8 keys are present
  for (const pageName of MANDATORY_PAGES) {
    const key = PAGE_NAME_TO_KEY[pageName];
    if (!pageIds[key]) {
      throw new Error(
        `createDocPages: Missing page ID for "${pageName}" (key: ${key})`,
      );
    }
  }

  return pageIds;
}

/**
 * Build a prompt for updating a specific Notion page.
 *
 * Pure function -- no I/O. Returns a prompt string that instructs the agent
 * to read the current page content and apply the update.
 *
 * @param pageId - The Notion page ID to update
 * @param pageName - Human-readable page name (e.g., "Architecture")
 * @param content - The content to apply as an update
 * @returns The prompt string for the agent
 */
export function buildPageUpdatePrompt(
  pageId: string,
  pageName: string,
  content: string,
): string {
  return `Update the Notion page "${pageName}" (ID: ${pageId}).

First, read the current page content using notion_read_page to understand the existing structure.
Then, apply the following update using notion_update_page:

${content}

Preserve the existing page structure and append or modify sections as appropriate.
Do not delete existing content unless the update explicitly replaces it.`;
}

/**
 * Execute a page update with graceful degradation.
 *
 * Update functions are non-critical -- Notion failures should not halt
 * the pipeline. Errors are caught and logged as warnings.
 *
 * @param pageId - The Notion page ID
 * @param pageName - Human-readable page name
 * @param content - Content for the update prompt
 * @param executeQueryFn - Injectable query function
 */
async function executePageUpdate(
  pageId: string,
  pageName: string,
  content: string,
  executeQueryFn: ExecuteQueryFn,
): Promise<void> {
  try {
    const prompt = buildPageUpdatePrompt(pageId, pageName, content);
    const result = await executeQueryFn({ prompt });
    if (!result.ok) {
      console.warn(
        `[forge/docs] Warning: Failed to update ${pageName} page: ${result.error?.message ?? "Unknown error"}`,
      );
    }
  } catch (err) {
    console.warn(
      `[forge/docs] Warning: Error updating ${pageName} page: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Format phase report data for architecture page update.
 */
function formatArchitectureContent(report: PhaseReport): string {
  const changes =
    report.architectureChanges.length > 0
      ? report.architectureChanges.map((c) => `- ${c}`).join("\n")
      : "- No architecture changes in this phase";

  return `## Phase ${report.phaseNumber}: ${report.phaseName}

### Architecture Changes
${changes}

### Phase Goals
${report.goals}`;
}

/**
 * Format phase report data for data flow page update.
 */
function formatDataFlowContent(report: PhaseReport): string {
  return `## Phase ${report.phaseNumber}: ${report.phaseName}

### Data Flow Updates
${report.goals}

### Test Coverage
- Passed: ${report.testResults.passed}
- Failed: ${report.testResults.failed}
- Total: ${report.testResults.total}`;
}

/**
 * Format phase report data for API reference page update.
 */
function formatApiReferenceContent(report: PhaseReport): string {
  return `## Phase ${report.phaseNumber}: ${report.phaseName}

### API Changes
${report.goals}

### Architecture Context
${report.architectureChanges.length > 0 ? report.architectureChanges.map((c) => `- ${c}`).join("\n") : "No architecture changes affecting APIs"}`;
}

/**
 * Format phase report data for component index page update.
 */
function formatComponentIndexContent(report: PhaseReport): string {
  return `## Phase ${report.phaseNumber}: ${report.phaseName}

### Components Updated
${report.goals}

### Test Results
- ${report.testResults.passed}/${report.testResults.total} tests passing`;
}

/**
 * Format phase report data for dev workflow page update.
 */
function formatDevWorkflowContent(report: PhaseReport): string {
  const issues =
    report.issues.length > 0
      ? report.issues.map((i) => `- ${i}`).join("\n")
      : "- No issues encountered";

  return `## Phase ${report.phaseNumber}: ${report.phaseName}

### Workflow Updates
${report.goals}

### Known Issues
${issues}

### Budget Used
$${report.budgetUsed.toFixed(2)}`;
}

/**
 * Update the Architecture page with data from a phase report.
 *
 * Requirement: DOC-02
 *
 * @param pageId - Architecture page ID
 * @param report - Phase report data
 * @param options - Optional executeQueryFn override
 */
export async function updateArchitecture(
  pageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  if (!options?.executeQueryFn) return;
  const content = formatArchitectureContent(report);
  await executePageUpdate(pageId, "Architecture", content, options.executeQueryFn);
}

/**
 * Update the Data Flow page with data from a phase report.
 *
 * Requirement: DOC-02
 */
export async function updateDataFlow(
  pageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  if (!options?.executeQueryFn) return;
  const content = formatDataFlowContent(report);
  await executePageUpdate(pageId, "Data Flow", content, options.executeQueryFn);
}

/**
 * Update the API Reference page with data from a phase report.
 *
 * Requirement: DOC-02
 */
export async function updateApiReference(
  pageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  if (!options?.executeQueryFn) return;
  const content = formatApiReferenceContent(report);
  await executePageUpdate(
    pageId,
    "API Reference",
    content,
    options.executeQueryFn,
  );
}

/**
 * Update the Component Index page with data from a phase report.
 *
 * Requirement: DOC-02
 */
export async function updateComponentIndex(
  pageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  if (!options?.executeQueryFn) return;
  const content = formatComponentIndexContent(report);
  await executePageUpdate(
    pageId,
    "Component Index",
    content,
    options.executeQueryFn,
  );
}

/**
 * Update the Dev Workflow page with data from a phase report.
 *
 * Requirement: DOC-02
 */
export async function updateDevWorkflow(
  pageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  if (!options?.executeQueryFn) return;
  const content = formatDevWorkflowContent(report);
  await executePageUpdate(
    pageId,
    "Dev Workflow",
    content,
    options.executeQueryFn,
  );
}

/**
 * Create a new ADR (Architecture Decision Record) page under the ADRs parent.
 *
 * Requirement: DOC-03
 *
 * @param parentPageId - The ADRs parent page ID
 * @param adr - The ADR record data
 * @param options - Optional executeQueryFn override
 * @returns The created page ID
 * @throws Error if SDK query fails
 */
export async function createADR(
  parentPageId: string,
  adr: ADRRecord,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<string> {
  const executeQueryFn = options?.executeQueryFn;
  if (!executeQueryFn) {
    throw new Error(
      "createADR requires an executeQueryFn (no default SDK integration)",
    );
  }

  const prompt = `Create a new ADR (Architecture Decision Record) page under the Notion parent page with ID "${parentPageId}".

Page title: "ADR: ${adr.title}"

Content:
## Status
${adr.status}

## Context
${adr.context}

## Decision
${adr.decision}

## Consequences
${adr.consequences}

Use notion_create_page to create the page. Return the created page ID in your response.`;

  const result = await executeQueryFn({ prompt });
  if (!result.ok) {
    throw new Error(
      `Failed to create ADR page: ${result.error?.message ?? "Unknown error"}`,
    );
  }

  return result.result ?? "";
}

/**
 * Create a phase report page under the Phase Reports parent.
 *
 * Content includes: goals, test results table, architecture changes list,
 * issues list, and budget spent.
 *
 * Requirement: DOC-02
 *
 * @param parentPageId - The Phase Reports parent page ID
 * @param report - Phase report data
 * @param options - Optional executeQueryFn override
 * @returns The created page ID
 * @throws Error if SDK query fails
 */
export async function createPhaseReport(
  parentPageId: string,
  report: PhaseReport,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<string> {
  const executeQueryFn = options?.executeQueryFn;
  if (!executeQueryFn) {
    throw new Error(
      "createPhaseReport requires an executeQueryFn (no default SDK integration)",
    );
  }

  const architectureChanges =
    report.architectureChanges.length > 0
      ? report.architectureChanges.map((c) => `- ${c}`).join("\n")
      : "- None";

  const issues =
    report.issues.length > 0
      ? report.issues.map((i) => `- ${i}`).join("\n")
      : "- None";

  const prompt = `Create a new phase report page under the Notion parent page with ID "${parentPageId}".

Page title: "Phase ${report.phaseNumber}: ${report.phaseName}"

Content:
## Goals
${report.goals}

## Test Results
| Metric | Count |
|--------|-------|
| Passed | ${report.testResults.passed} |
| Failed | ${report.testResults.failed} |
| Total  | ${report.testResults.total} |

## Architecture Changes
${architectureChanges}

## Issues
${issues}

## Budget
$${report.budgetUsed.toFixed(2)} spent

Use notion_create_page to create the page. Return the created page ID in your response.`;

  const result = await executeQueryFn({ prompt });
  if (!result.ok) {
    throw new Error(
      `Failed to create phase report page: ${result.error?.message ?? "Unknown error"}`,
    );
  }

  return result.result ?? "";
}

/**
 * Publish final milestone documentation across all pages.
 *
 * Updates each page with "Final - Milestone Complete" status and creates
 * a milestone completion summary page under phaseReports.
 *
 * Requirement: DOC-04
 *
 * @param pageIds - All 8 page IDs
 * @param summary - Milestone summary data
 * @param options - Optional executeQueryFn override
 */
export async function publishFinalDocs(
  pageIds: NotionPageIds,
  summary: MilestoneSummary,
  options?: { executeQueryFn?: ExecuteQueryFn },
): Promise<void> {
  const executeQueryFn = options?.executeQueryFn;
  if (!executeQueryFn) return;

  const highlights =
    summary.highlights.length > 0
      ? summary.highlights.map((h) => `- ${h}`).join("\n")
      : "- Milestone completed successfully";

  // Update each page with milestone completion status
  const pageEntries = Object.entries(pageIds) as Array<
    [keyof NotionPageIds, string]
  >;

  for (const [key, pageId] of pageEntries) {
    const pageName = Object.entries(PAGE_NAME_TO_KEY).find(
      ([, k]) => k === key,
    )?.[0] ?? key;

    const statusContent = `## Milestone Status: COMPLETE

This documentation is final for the current milestone.

### Summary
- Total Phases: ${summary.totalPhases}
- Total Tests: ${summary.totalTests}
- Total Budget: $${summary.totalBudget.toFixed(2)}
- Requirements: ${summary.requirements.verified}/${summary.requirements.total} verified

### Highlights
${highlights}`;

    await executePageUpdate(pageId, pageName, statusContent, executeQueryFn);
  }

  // Create a milestone completion summary page under phaseReports
  try {
    const milestonePrompt = `Create a new page under the Notion parent page with ID "${pageIds.phaseReports}".

Page title: "Milestone Complete - Final Summary"

Content:
## Milestone Completion Summary

### Statistics
- **Total Phases:** ${summary.totalPhases}
- **Total Tests:** ${summary.totalTests}
- **Total Budget:** $${summary.totalBudget.toFixed(2)}
- **Requirements Verified:** ${summary.requirements.verified}/${summary.requirements.total}

### Highlights
${highlights}

### Status
All phases complete. Documentation finalized.

Use notion_create_page to create the page.`;

    const result = await executeQueryFn({ prompt: milestonePrompt });
    if (!result.ok) {
      console.warn(
        `[forge/docs] Warning: Failed to create milestone summary page: ${result.error?.message ?? "Unknown error"}`,
      );
    }
  } catch (err) {
    console.warn(
      `[forge/docs] Warning: Error creating milestone summary page: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
