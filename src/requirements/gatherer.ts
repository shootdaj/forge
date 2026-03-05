/**
 * Requirements Gatherer
 *
 * Conducts interactive requirements gathering across 8 categories
 * using the Agent SDK. Builds a comprehensive prompt, invokes the
 * agent, and returns structured requirements.
 *
 * Requirements: REQ-01, REQ-02, REQ-03, REQ-04
 */

import type { ForgeConfig } from "../config/schema.js";
import type { QueryResult } from "../sdk/types.js";
import { executeQuery } from "../sdk/query-wrapper.js";
import {
  parseRequirementsOutput,
  detectComplianceFlags,
  formatRequirementsDoc,
} from "./parser.js";
import type { GatherResult } from "./types.js";

/**
 * Options for gatherRequirements.
 */
export interface GatherOptions {
  /** Injectable executeQuery function for testing */
  executeQueryFn?: typeof executeQuery;
  /** Project name for prompt context */
  projectName?: string;
}

/**
 * Build the comprehensive requirements gathering prompt.
 *
 * The prompt instructs the agent to gather requirements across all 8
 * categories, covering 25+ topics. It specifies the output format as
 * structured markdown with ## R{N}: Title headers and labeled fields.
 *
 * @param projectName - Optional project name for context
 * @returns The requirements gathering prompt string
 */
export function buildRequirementsPrompt(projectName?: string): string {
  const projectRef = projectName
    ? `for the project "${projectName}"`
    : "for this project";

  return `You are conducting a comprehensive requirements gathering session ${projectRef}. Your goal is to produce a complete, structured set of software requirements by exploring the following 8 categories systematically.

## Categories to Cover

### 1. Core
- Core functionality and features
- User workflows and interactions
- User personas and roles
- Edge cases and error handling
- Input/output specifications

### 2. Data
- Data model and entity relationships
- Data lifecycle (creation, update, deletion, archival)
- State management approach
- Storage requirements and persistence
- Data migration strategy

### 3. Security
- Authentication mechanism (OAuth, JWT, session, etc.)
- Authorization model (RBAC, ABAC, etc.)
- Compliance requirements (SOC 2, HIPAA, GDPR, PCI DSS, WCAG)
- Encryption at rest and in transit
- Audit logging and trail

### 4. Integrations
- Third-party services and APIs
- API design (REST, GraphQL, gRPC)
- Webhook and event handling
- Notification system (email, push, SMS)
- Payment processing

### 5. Quality
- Performance targets (response time, throughput)
- Error handling and resilience patterns
- Input validation rules
- Testing strategy requirements
- Reliability and uptime targets

### 6. Infrastructure
- Deployment target (cloud provider, PaaS)
- Observability (logging, metrics, tracing, health endpoints)
- CI/CD pipeline requirements
- Environment strategy (dev, staging, prod)
- Scaling approach (horizontal, vertical, auto)

### 7. UX
- Design system and component patterns
- Accessibility requirements (WCAG level)
- Internationalization (i18n) and localization
- Responsive design targets
- Loading states and optimistic UI

### 8. Business
- MVP scope vs full product scope
- Success metrics and KPIs
- Acceptance criteria for launch
- Prioritization of features (must-have vs nice-to-have)
- Timeline and milestone expectations

## Output Format

For each requirement you identify, output it in this exact format:

\`\`\`
## R{N}: Title

**Category:** [One of: Core, Data, Security, Integrations, Quality, Infrastructure, UX, Business]
**Description:** A clear, concise description of the requirement.
**Acceptance Criteria:**
- Testable criterion 1
- Testable criterion 2
- Testable criterion 3
**Edge Cases:**
- Edge case 1
- Edge case 2
**Performance:** Performance target or constraint (if applicable)
**Security:** Security consideration (if applicable)
**Observability:** Monitoring/logging requirement (if applicable)
\`\`\`

Number requirements sequentially starting from R1. Cover all 8 categories. Be thorough -- aim for at least 15-25 requirements total. Each acceptance criterion must be testable and specific. Each requirement should be atomic (one concern per requirement).

Analyze the project context (any existing code, config files, README, SPEC documents) and generate the requirements now.`;
}

/**
 * Gather requirements using the Agent SDK.
 *
 * Builds a comprehensive prompt, invokes executeQuery to run the
 * gathering agent, then parses the output into structured requirements.
 *
 * @param config - Forge configuration (for model, budget settings)
 * @param options - Optional overrides (injectable executeQuery, project name)
 * @returns GatherResult with parsed requirements, compliance flags, and formatted doc
 * @throws Error if the SDK query fails
 */
export async function gatherRequirements(
  config: ForgeConfig,
  options?: GatherOptions,
): Promise<GatherResult> {
  const queryFn = options?.executeQueryFn ?? executeQuery;
  const prompt = buildRequirementsPrompt(options?.projectName);

  const result: QueryResult = await queryFn({
    prompt,
    model: config.model,
    maxBudgetUsd: config.maxBudgetPerStep,
    maxTurns: config.maxTurnsPerStep,
    useClaudeCodePreset: true,
    loadSettings: true,
  });

  if (!result.ok) {
    throw new Error(
      `Requirements gathering failed: ${result.error.message} (category: ${result.error.category})`,
    );
  }

  const rawOutput = result.result;
  const requirements = parseRequirementsOutput(rawOutput);
  const complianceFlags = detectComplianceFlags(requirements);
  const formattedDoc = formatRequirementsDoc(requirements, complianceFlags);

  return {
    requirements,
    complianceFlags,
    rawOutput,
    formattedDoc,
  };
}
