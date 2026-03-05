/**
 * Requirements Module - Public API
 *
 * Re-exports all types and functions for the requirements
 * gathering, parsing, compliance detection, and formatting pipeline.
 *
 * Requirements: REQ-01, REQ-02, REQ-03, REQ-04
 */

// Types
export type {
  Requirement,
  RequirementCategory,
  ComplianceFlags,
  GatherResult,
} from "./types.js";

// Gatherer
export { gatherRequirements, buildRequirementsPrompt } from "./gatherer.js";
export type { GatherOptions } from "./gatherer.js";

// Parser
export {
  parseRequirementsOutput,
  detectComplianceFlags,
  formatRequirementsDoc,
} from "./parser.js";
