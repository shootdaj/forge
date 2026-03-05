# Phase 8 Context: Enhancement Layer

## Phase Goal

Forge has deep requirements gathering, UAT as a final gate, and Notion documentation -- completing the full autonomous development lifecycle.

## Requirements

REQ-01, REQ-02, REQ-03, REQ-04, DOC-01, DOC-02, DOC-03, DOC-04, UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06

## Decisions

### 1. Requirements Gatherer Architecture

`src/requirements/gatherer.ts` implements the interactive requirements gathering flow. It runs during `forge init` and uses `executeQuery()` to conduct a structured conversation with the user across 8 categories:

1. **Core** -- functionality, user workflows, personas, edge cases
2. **Data** -- data model, lifecycle, state management
3. **Security** -- auth, compliance (SOC 2, HIPAA, GDPR, PCI DSS, WCAG)
4. **Integrations** -- third-party services, notifications, payments
5. **Quality** -- performance, error handling, resilience, validation
6. **Infrastructure** -- deployment, observability, CI/CD, environments
7. **UX** -- design patterns, accessibility, i18n
8. **Business** -- launch scope, success metrics, acceptance criteria

The gatherer uses a single long-running `executeQuery()` call with the `claude_code` system prompt preset. The agent conducts the conversation and produces structured output. The gatherer extracts the structured requirements from the agent's response.

Each requirement follows the structured format:
```
## R1: Title
**Description:** ...
**Acceptance Criteria:** - bullet list
**Edge Cases:** - bullet list
**Performance:** target
**Security:** notes
**Observability:** requirements
```

Compliance flags (SOC 2, HIPAA, GDPR, PCI DSS, WCAG) are detected from conversation answers and stored in config. They drive additional build requirements (audit logging, encryption, consent flows, etc.).

Output: `REQUIREMENTS.md` in project directory with numbered R1, R2, ... format.

### 2. Requirements Gatherer Implementation

The gatherer is a module with these functions:
- `gatherRequirements(config, options?)`: Main entry point. Uses `executeQuery()` with a comprehensive system prompt listing all 8 categories and 25+ topics. Returns structured requirements.
- `parseRequirementsOutput(rawOutput: string)`: Parses the agent's markdown output into structured `Requirement[]` array.
- `detectComplianceFlags(requirements: Requirement[])`: Scans requirements for compliance keywords, returns `ComplianceFlags` object.
- `buildRequirementsPrompt(config)`: Builds the system prompt for the gathering agent.
- `formatRequirementsDoc(requirements: Requirement[], complianceFlags: ComplianceFlags)`: Formats the final REQUIREMENTS.md content.

The `forge init` command (from Phase 7) is updated to call `gatherRequirements()` instead of the current stub.

### 3. UAT Runner Architecture

`src/uat/runner.ts` implements User Acceptance Testing. UAT runs after spec compliance passes (in the pipeline controller's UAT state).

UAT workflow:
1. Extract user workflows from REQUIREMENTS.md (each requirement's acceptance criteria become test scenarios)
2. Start the application stack (via `docker compose up -d` if docker-compose file exists, otherwise skip Docker and test directly)
3. Wait for health check (configurable health endpoint)
4. For each workflow, run a `executeQuery()` step that tests the workflow end-to-end
5. Agent writes structured JSON results to `.forge/uat/{workflowId}.json`
6. Programmatic verification reads the JSON and checks `steps_failed.length === 0`
7. Aggregate results into UATResult
8. Tear down (docker compose down)

Application type detection (from config):
- **Web app**: Agent uses headless browser (Playwright via MCP or CLI)
- **API**: Agent uses curl/fetch via bash
- **CLI**: Agent runs commands and checks stdout/stderr/exit codes

Safety guardrails are enforced via the UAT prompt:
- Sandbox credentials only (from .env.test or docker-compose.test.yml)
- Local SMTP capture (Mailhog/Mailtrap)
- Test database (Docker container, wiped after each run)
- Test OAuth apps / mock providers

### 4. UAT Integration with Pipeline

The pipeline controller (Phase 6) already has the UAT state in its FSM. Phase 8 implements the actual UAT execution:
- `runUAT(ctx: PipelineContext)`: Called by pipeline-controller in the `uat` state
- `extractUserWorkflows(requirementsPath: string)`: Parses REQUIREMENTS.md for testable workflows
- `buildUATPrompt(workflow, state, appType)`: Builds the prompt for the testing agent
- `verifyUATResults(workflowId, forgeDir)`: Reads JSON results and verifies programmatically

UAT failure triggers gap closure:
- Pipeline controller calls `runUATGapClosure(failedWorkflows, ctx)`
- Produces targeted fix plans for failed workflows
- Retries UAT (up to config.maxRetries)
- If UAT can't pass, returns "stuck" result

### 5. Notion Documentation Module

`src/docs/notion.ts` implements Notion page management via the Notion MCP tools.

Functions:
- `createDocPages(parentPageId: string, projectName: string)`: Creates 8 mandatory pages under the parent. Returns page IDs stored in config.
- `updateArchitecture(pageId, phaseReport)`: Updates architecture page
- `updateDataFlow(pageId, phaseReport)`: Updates data flow page
- `updateApiReference(pageId, phaseReport)`: Updates API reference
- `updateComponentIndex(pageId, phaseReport)`: Updates component index
- `updateDevWorkflow(pageId, phaseReport)`: Updates dev workflow
- `createADR(parentPageId, decision)`: Creates new ADR page
- `createPhaseReport(parentPageId, phaseReport)`: Creates phase report page
- `publishFinalDocs(config, state)`: Final milestone documentation

The Notion module uses `executeQuery()` with MCP server configuration for the Notion API. Each update is an agent step that reads the current page content and applies diffs.

However, since the AX orchestrator already handles Notion updates externally (via background agents in `/ax:phase`), the Forge-internal Notion module focuses on:
1. **Init**: Creating the 8 page structure during `forge init`
2. **Per-phase**: Providing the data/content for updates (the actual Notion API calls can be done by the orchestrating agent or by the module itself)
3. **Final**: Publishing milestone completion docs

### 6. Integration with Existing Modules

The `forge init` command in `src/cli/index.ts` is updated:
- Calls `gatherRequirements()` to run interactive gathering
- Calls `createDocPages()` to set up Notion structure
- Stores Notion page IDs in config
- Creates REQUIREMENTS.md, TEST_GUIDE.md, injects testing methodology

The pipeline controller's UAT state calls `runUAT()`:
- Already has the state transition in the FSM
- Phase 8 provides the actual implementation

### 7. Scope Boundaries

**In scope for Phase 8:**
- Requirements gatherer (interactive, 8 categories, structured R1/R2 format)
- Compliance flag detection and storage
- UAT runner (Docker-based, app type detection, safety guardrails)
- UAT gap closure integration with pipeline
- Notion page creation during init (8 mandatory pages)
- Notion per-phase update helpers
- Final milestone documentation publishing
- Integration of all three with existing CLI and pipeline modules

**Out of scope (v2):**
- Mobile app UAT (emulator-based testing)
- Live dashboard for progress monitoring
- Webhook/Slack notifications
- Multiple concurrent projects

### 8. Testing Strategy

- Unit tests: Requirements parser, compliance detection, workflow extraction, UAT prompt builder, UAT result verification, Notion page ID management
- Integration tests: Requirements gathering with mocked SDK, UAT with mocked Docker/SDK, Notion with mocked MCP
- Scenario tests: Full `forge init` flow (mocked interactive), UAT pass/fail/retry cycle, Notion lifecycle

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology
