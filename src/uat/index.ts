/**
 * UAT Module Public API
 *
 * Re-exports all types and functions for the UAT runner.
 *
 * Requirements: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
 */

// Types
export type {
  AppType,
  UATWorkflow,
  WorkflowResult,
  UATResult,
  UATContext,
  SafetyConfig,
} from "./types.js";

// Workflow extraction and gap closure
export {
  extractUserWorkflows,
  buildSafetyPrompt,
  runUATGapClosure,
} from "./workflows.js";

// Runner functions
export {
  detectAppType,
  startApplication,
  stopApplication,
  waitForHealth,
  buildUATPrompt,
  verifyUATResults,
  runUAT,
} from "./runner.js";
