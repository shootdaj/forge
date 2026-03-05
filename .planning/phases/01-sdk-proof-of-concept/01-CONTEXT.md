# Phase 1: SDK Proof of Concept - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the Agent SDK API surface with a working query() call, structured output extraction, cost tracking, and error categorization. This phase produces a proof-of-concept module and comprehensive divergence documentation -- no production orchestrator code yet. Everything downstream (config, state, step runner, verifiers, pipeline) depends on the SDK behaviors validated here.

</domain>

<decisions>
## Implementation Decisions

### SDK Configuration Validation
- Validate all three critical configuration options: `systemPrompt: { type: "preset", preset: "claude_code" }`, `settingSources: ["user", "project", "local"]`, and `permissionMode: "bypassPermissions"` with `allowDangerouslySkipPermissions: true`
- Test with a simple, deterministic prompt (e.g., "Write a file and read it back") to confirm tools work
- Use `model: "claude-sonnet-4-5-20250929"` for POC to minimize cost (Opus not needed for validation)
- Capture session_id from the init system message for logging

### Structured Output Extraction
- Use `outputFormat: { type: "json_schema", schema: ... }` with a Zod-derived JSON schema
- Define a simple test schema (e.g., `{ files_created: string[], summary: string }`) to validate the pipeline
- Use `zod-to-json-schema` package (since we're using Zod 3.x, not Zod 4 with native `z.toJSONSchema()`)
- Validate that `message.structured_output` contains parsed JSON matching the schema

### Cost Data Extraction
- Extract `total_cost_usd` from the SDKResultMessage (message.type === "result")
- Verify cost is a number > 0 for successful queries
- Track `num_turns` and `usage` fields alongside cost for full visibility
- Document whether cost includes extended thinking tokens

### Error Categorization
- Categorize SDK errors into distinct types: network, auth, budget_exceeded, max_turns, execution_error, structured_output_retry_exceeded
- Map SDKResultMessage subtypes: `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`
- Distinguish SDK-level errors (the query itself failed) from agent-level failures (query completed but work wasn't done)
- Create a typed error hierarchy that downstream components can switch on

### Divergence Documentation
- Create a DIVERGENCES.md file in the phase directory documenting every difference between SPEC.md pseudocode and actual SDK behavior
- Include: option names, message types, result structure, cost tracking fields, permission mode behavior
- Format as a lookup table: SPEC assumption -> Actual SDK behavior -> Impact on implementation

### Claude's Discretion
- Exact test prompt wording for validation
- Internal code organization within the POC module
- Whether to use async generator iteration or collect-all-messages pattern
- Logging verbosity during POC execution

</decisions>

<specifics>
## Specific Ideas

- The POC should be importable as a module, not just a script -- downstream phases will use its patterns
- Keep the POC focused: one file for SDK wrapper, one for types, one for the divergence doc
- Unit tests should mock the SDK's async generator to test message processing without burning tokens
- Integration tests (when run manually) should make a real query() call to validate end-to-end

</specifics>

<deferred>
## Deferred Ideas

- V2 session API (`unstable_v2_createSession`) exploration -- Phase 8 (requirements gathering needs multi-turn)
- Subagent configuration testing -- Phase 6 (pipeline controller needs parallel execution)
- MCP server integration testing -- Phase 8 (Notion docs)
- Hook system exploration (PreToolUse, PostToolUse) -- Phase 3 (step runner progress monitoring)

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 01-sdk-proof-of-concept*
*Context gathered: 2026-03-05*
