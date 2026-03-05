/**
 * Requirements Module Types
 *
 * Type definitions for the requirements gathering, parsing,
 * compliance detection, and document formatting pipeline.
 *
 * Requirements: REQ-01, REQ-02, REQ-03, REQ-04
 */

/**
 * The 8 requirement categories that the gatherer covers.
 * Each maps to a domain of concerns during requirements elicitation.
 */
export type RequirementCategory =
  | "Core"
  | "Data"
  | "Security"
  | "Integrations"
  | "Quality"
  | "Infrastructure"
  | "UX"
  | "Business";

/**
 * A single structured requirement extracted from agent output.
 * Uses R1, R2, ... numbering for traceability throughout the pipeline.
 */
export interface Requirement {
  /** Unique identifier in "R1", "R2" format */
  id: string;
  /** Short title for the requirement */
  title: string;
  /** Which of the 8 categories this belongs to */
  category: RequirementCategory;
  /** Full description of what is required */
  description: string;
  /** Testable acceptance criteria (bullet list) */
  acceptanceCriteria: string[];
  /** Known edge cases to handle (bullet list) */
  edgeCases: string[];
  /** Performance targets or constraints */
  performance?: string;
  /** Security considerations */
  security?: string;
  /** Observability/monitoring requirements */
  observability?: string;
}

/**
 * Compliance framework flags detected from requirement text.
 * Each flag indicates the project touches that compliance domain.
 */
export interface ComplianceFlags {
  soc2: boolean;
  hipaa: boolean;
  gdpr: boolean;
  pciDss: boolean;
  wcag: boolean;
}

/**
 * Complete result from the requirements gathering pipeline.
 * Contains both structured data and formatted output.
 */
export interface GatherResult {
  /** Parsed structured requirements */
  requirements: Requirement[];
  /** Detected compliance flags */
  complianceFlags: ComplianceFlags;
  /** Raw markdown output from the agent */
  rawOutput: string;
  /** Formatted REQUIREMENTS.md content */
  formattedDoc: string;
}
