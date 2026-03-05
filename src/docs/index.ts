/**
 * Forge Notion Documentation Module - Public API
 *
 * Re-exports all types and functions for Notion page lifecycle management.
 *
 * Requirements: DOC-01, DOC-02, DOC-03, DOC-04
 */

// Types
export type {
  NotionPageIds,
  PhaseReport,
  ADRRecord,
  MilestoneSummary,
  ExecuteQueryFn,
} from "./types.js";

// Constants
export { MANDATORY_PAGES, PAGE_NAME_TO_KEY } from "./types.js";

// Functions
export {
  createDocPages,
  buildPageUpdatePrompt,
  updateArchitecture,
  updateDataFlow,
  updateApiReference,
  updateComponentIndex,
  updateDevWorkflow,
  createADR,
  createPhaseReport,
  publishFinalDocs,
} from "./notion.js";
