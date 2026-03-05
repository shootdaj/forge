/**
 * Requirements Parser
 *
 * Pure functions for parsing agent markdown output into structured
 * requirements, detecting compliance flags, and formatting REQUIREMENTS.md.
 *
 * Requirements: REQ-01, REQ-02, REQ-03, REQ-04
 */

import type {
  Requirement,
  RequirementCategory,
  ComplianceFlags,
} from "./types.js";

/** Valid requirement categories for validation */
const VALID_CATEGORIES: ReadonlySet<string> = new Set<string>([
  "Core",
  "Data",
  "Security",
  "Integrations",
  "Quality",
  "Infrastructure",
  "UX",
  "Business",
]);

/**
 * Parse raw markdown output from the agent into structured Requirement[].
 *
 * Expected format:
 * ```
 * ## R1: Title
 * **Category:** Core
 * **Description:** ...
 * **Acceptance Criteria:**
 * - criterion 1
 * - criterion 2
 * **Edge Cases:**
 * - edge 1
 * **Performance:** ...
 * **Security:** ...
 * **Observability:** ...
 * ```
 *
 * Handles missing fields gracefully (defaults to empty string/array).
 * Category defaults to "Core" if missing or unrecognized.
 */
export function parseRequirementsOutput(rawOutput: string): Requirement[] {
  if (!rawOutput || !rawOutput.trim()) {
    return [];
  }

  const requirements: Requirement[] = [];

  // Split on requirement headers: ## R{N}: Title
  const reqPattern = /^## (R\d+):\s*(.+)$/gm;
  const matches: Array<{ id: string; title: string; startIndex: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = reqPattern.exec(rawOutput)) !== null) {
    matches.push({
      id: match[1],
      title: match[2].trim(),
      startIndex: match.index + match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const { id, title, startIndex } = matches[i];
    const endIndex =
      i + 1 < matches.length
        ? rawOutput.lastIndexOf("\n##", matches[i + 1].startIndex)
        : rawOutput.length;

    const section = rawOutput.slice(startIndex, endIndex);

    const category = extractField(section, "Category");
    const validCategory: RequirementCategory =
      category && VALID_CATEGORIES.has(category)
        ? (category as RequirementCategory)
        : "Core";

    requirements.push({
      id,
      title,
      category: validCategory,
      description: extractField(section, "Description") ?? "",
      acceptanceCriteria: extractBulletList(section, "Acceptance Criteria"),
      edgeCases: extractBulletList(section, "Edge Cases"),
      performance: extractField(section, "Performance") || undefined,
      security: extractField(section, "Security") || undefined,
      observability: extractField(section, "Observability") || undefined,
    });
  }

  return requirements;
}

/**
 * Extract a single-line field value from a section.
 * Matches **FieldName:** value (on the same line).
 */
function extractField(section: string, fieldName: string): string | undefined {
  // Match **FieldName:** followed by content on the same line
  const pattern = new RegExp(
    `\\*\\*${escapeRegExp(fieldName)}:\\*\\*\\s*(.+?)\\s*$`,
    "m",
  );
  const match = pattern.exec(section);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  return undefined;
}

/**
 * Extract a bullet list following a **FieldName:** header.
 * Collects all lines starting with `- ` until the next bold field or section end.
 */
function extractBulletList(section: string, fieldName: string): string[] {
  // Find the field header
  const headerPattern = new RegExp(
    `\\*\\*${escapeRegExp(fieldName)}:\\*\\*`,
    "m",
  );
  const headerMatch = headerPattern.exec(section);
  if (!headerMatch) {
    return [];
  }

  const afterHeader = section.slice(
    headerMatch.index + headerMatch[0].length,
  );
  const lines = afterHeader.split("\n");
  const items: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    } else if (trimmed.startsWith("**") && trimmed.includes(":**")) {
      // Hit the next field
      break;
    } else if (trimmed.startsWith("## ")) {
      // Hit the next requirement section
      break;
    }
    // Skip blank lines and continuation text between bullet header and bullets
  }

  return items;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compliance keyword definitions.
 * Each flag maps to a set of case-insensitive keywords/phrases.
 */
const COMPLIANCE_KEYWORDS: Record<keyof ComplianceFlags, string[]> = {
  soc2: ["soc 2", "soc2", "audit log"],
  hipaa: ["hipaa", "phi", "protected health"],
  gdpr: ["gdpr", "data protection", "right to erasure", "consent"],
  pciDss: ["pci", "payment card", "cardholder"],
  wcag: ["wcag", "accessibility", "a11y", "screen reader"],
};

/**
 * Scan all requirement text for compliance keywords.
 *
 * Checks description, acceptance criteria, edge cases, and security fields
 * for each requirement. Case-insensitive matching.
 *
 * Returns an object with boolean flags for each compliance framework.
 */
export function detectComplianceFlags(
  requirements: Requirement[],
): ComplianceFlags {
  // Collect all searchable text from all requirements
  const allText = requirements
    .map((req) =>
      [
        req.description,
        ...req.acceptanceCriteria,
        ...req.edgeCases,
        req.security ?? "",
        req.performance ?? "",
        req.observability ?? "",
      ].join(" "),
    )
    .join(" ")
    .toLowerCase();

  const flags: ComplianceFlags = {
    soc2: false,
    hipaa: false,
    gdpr: false,
    pciDss: false,
    wcag: false,
  };

  for (const [flag, keywords] of Object.entries(COMPLIANCE_KEYWORDS)) {
    flags[flag as keyof ComplianceFlags] = keywords.some((keyword) =>
      allText.includes(keyword),
    );
  }

  return flags;
}

/**
 * Format requirements and compliance flags into REQUIREMENTS.md content.
 *
 * Produces a complete markdown document with:
 * - Title and generation date
 * - Compliance section (if any flags active)
 * - Numbered requirements with all structured fields
 */
export function formatRequirementsDoc(
  requirements: Requirement[],
  complianceFlags: ComplianceFlags,
): string {
  const lines: string[] = [];

  // Header
  lines.push("# Requirements");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Compliance section
  const activeFlags = getActiveComplianceFlags(complianceFlags);
  if (activeFlags.length > 0) {
    lines.push("## Compliance");
    lines.push("");
    lines.push(
      "The following compliance frameworks apply to this project:",
    );
    lines.push("");
    for (const flag of activeFlags) {
      lines.push(`- ${flag}`);
    }
    lines.push("");
  }

  // Requirements
  for (const req of requirements) {
    lines.push(`## ${req.id}: ${req.title}`);
    lines.push("");
    lines.push(`**Category:** ${req.category}`);
    lines.push(`**Description:** ${req.description}`);

    if (req.acceptanceCriteria.length > 0) {
      lines.push("**Acceptance Criteria:**");
      for (const criterion of req.acceptanceCriteria) {
        lines.push(`- ${criterion}`);
      }
    }

    if (req.edgeCases.length > 0) {
      lines.push("**Edge Cases:**");
      for (const edge of req.edgeCases) {
        lines.push(`- ${edge}`);
      }
    }

    if (req.performance) {
      lines.push(`**Performance:** ${req.performance}`);
    }

    if (req.security) {
      lines.push(`**Security:** ${req.security}`);
    }

    if (req.observability) {
      lines.push(`**Observability:** ${req.observability}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get human-readable names of active compliance flags.
 */
function getActiveComplianceFlags(flags: ComplianceFlags): string[] {
  const names: string[] = [];
  if (flags.soc2) names.push("SOC 2");
  if (flags.hipaa) names.push("HIPAA");
  if (flags.gdpr) names.push("GDPR");
  if (flags.pciDss) names.push("PCI DSS");
  if (flags.wcag) names.push("WCAG");
  return names;
}
