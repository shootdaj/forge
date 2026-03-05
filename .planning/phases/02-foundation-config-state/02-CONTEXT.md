# Phase 2: Foundation (Config + State) - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Project configuration loading (`forge.config.json`) with Zod validation and sensible defaults, plus crash-safe state persistence (`forge-state.json`) with snake_case JSON / camelCase TypeScript mapping, atomic write-rename, and mutex for concurrent writes. This phase delivers the two foundational data layers that all downstream components depend on.

</domain>

<decisions>
## Implementation Decisions

### Config File Format and Loading
- Config file is `forge.config.json` in the project root directory
- Zod schema validates all fields with sensible defaults so a minimal config (even `{}`) works
- All config fields use `snake_case` in JSON, mapped to `camelCase` in TypeScript via a serialization layer
- Config is loaded once on startup via `loadConfig()` and passed as a parameter to downstream components (not global)
- Missing file returns all defaults; invalid file throws a clear validation error with field-level detail
- Config supports all SPEC.md fields: model, max_budget_total, max_budget_per_step, max_retries, max_compliance_rounds, max_turns_per_step, testing (stack, commands), verification (toggles), notion (page IDs), parallelism, deployment, notifications

### Config Defaults
- `model`: "claude-opus-4-6"
- `max_budget_total`: 200.00
- `max_budget_per_step`: 15.00
- `max_retries`: 3
- `max_compliance_rounds`: 5
- `max_turns_per_step`: 200
- `testing.stack`: "node"
- `verification`: all toggles true
- `parallelism.max_concurrent_phases`: 3
- `parallelism.enable_subagents`: true
- `parallelism.background_docs`: true
- `notifications`: all "stdout"

### State File Format and Persistence
- State file is `forge-state.json` in the project root directory
- JSON uses `snake_case` keys; TypeScript runtime uses `camelCase` properties
- Serialization layer handles bidirectional mapping (camelCase <-> snake_case) automatically
- State is NOT part of config -- they are separate files, loaded separately
- State tracks all SPEC.md fields: project_dir, started_at, model, requirements_doc, status, current_wave, project_initialized, scaffolded, phases (map), services_needed (array), mock_registry (map), skipped_items (array), credentials (map), human_guidance (map), spec_compliance (object), remaining_gaps (array), uat_results (object), total_budget_used (number)

### Crash Safety and Atomic Writes
- Atomic write-rename pattern: write to temp file, then `fs.renameSync()` to target path
- Temp file lives in the same directory as the target (ensures same filesystem for atomic rename)
- Mutex (in-process lock) prevents concurrent writes from corrupting the file
- State file must survive `kill -9`: since rename is atomic at the OS level, either the old or new file is present
- No partial writes -- the temp file is fully written and fsynced before rename

### State API Design
- `StateManager` class with `load()`, `save()`, `update(fn)` methods
- `update(fn)` acquires mutex, loads current state, applies the updater function, saves atomically
- `createInitialState(projectDir)` returns a fresh state object with all fields initialized
- State is Zod-validated on load to catch corruption or schema drift

### Claude's Discretion
- Internal module organization (file splitting within src/config/ and src/state/)
- Exact mutex implementation (simple promise-based lock vs library)
- Whether to use `JSON.stringify` with indentation for readability
- Error message wording for validation failures

</decisions>

<specifics>
## Specific Ideas

- The snake_case/camelCase mapping should be a generic utility that can be reused across the codebase (not specific to state or config)
- Config and state are separate concerns -- they should be in separate modules (src/config/ and src/state/)
- The state manager should be usable by the step runner (Phase 3) for cost tracking updates without knowing the full state shape

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping

---

*Phase: 02-foundation-config-state*
*Context gathered: 2026-03-05*
