# Phase 4: Programmatic Verifiers - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a registry of deterministic code checks (verifiers) that run after every step to validate build artifacts. Verifiers replace agent self-report with programmatic evidence. Each verifier is a pure function that inspects the filesystem/runs a command and returns a typed result. The phase runner (Phase 5) will consume these verifiers.

</domain>

<decisions>
## Implementation Decisions

### Verifier Interface
- Common `Verifier` interface: `(config: VerifierConfig) => Promise<VerifierResult>`
- `VerifierResult` has: `passed: boolean`, `verifier: string`, `details: string[]`, `errors: string[]`
- Each verifier is a standalone function, registered in a verifier registry
- Registry provides `runAll()` which runs all enabled verifiers via `Promise.all` (except Docker, which runs after others pass)

### Verifier Types (from requirements)
- **Files verifier (VER-01)**: Takes array of expected file paths, checks `fs.existsSync()` for each
- **Tests verifier (VER-02)**: Runs test command with JSON reporter, parses output for `numPassed`, `numFailed`, `numPending`. Passes when `numPassed > 0 AND numFailed === 0`
- **Typecheck verifier (VER-03)**: Runs `tsc --noEmit`, captures stderr, reports error count and messages
- **Lint verifier (VER-04)**: Runs configured lint command, captures output, reports errors
- **Coverage verifier (VER-05)**: Scans for new source files (from git diff), checks each has a corresponding `.test.ts` file
- **Observability verifier (VER-06)**: Checks for health endpoint existence, structured logging setup, error logging patterns
- **Docker verifier (VER-07)**: Runs `docker compose` smoke test — build, start, health check, stop
- **Deployment verifier (VER-08)**: Checks Dockerfile exists and builds, env vars are consistent between `.env.example` and deploy config

### Configuration
- Verifiers are enabled/disabled via `forge.config.json` verification section
- Each verifier reads its specific config (test command, lint command, docker compose file, etc.) from config
- If a verifier's prerequisites aren't met (e.g., no docker compose file), it's automatically skipped (not failed)
- Default: files, tests, typecheck, lint, coverage enabled. Observability, docker, deployment disabled by default (project-specific)

### Execution Strategy
- `runVerifiers()` runs all enabled non-docker verifiers in parallel via `Promise.all`
- Docker verifier runs sequentially AFTER all others pass (VER-09)
- Results aggregated into `VerificationReport`: array of `VerifierResult` + overall `passed` boolean
- Individual verifier failures don't prevent other verifiers from running (collect all failures)

### Error Reporting
- Each verifier returns structured results (not just pass/fail)
- `details` array contains human-readable descriptions of what was checked
- `errors` array contains specific failure messages with file paths/line numbers where applicable
- `VerificationReport` includes summary: total verifiers run, passed count, failed count, skipped count

### Claude's Discretion
- Exact file patterns for coverage verifier (which directories to scan)
- Observability verifier heuristics (what constitutes "structured logging")
- Docker health check timeout values
- Whether to use `child_process.exec` or `child_process.spawn` for command execution

</decisions>

<specifics>
## Specific Ideas

- Test verifier should support multiple test frameworks by parsing their JSON output formats (vitest, jest, mocha)
- Coverage verifier should handle common patterns: `src/foo.ts` → `src/foo.test.ts` or `test/foo.test.ts`
- Typecheck verifier should parse `tsc` output to extract error count and first N error messages
- All verifiers should have reasonable timeouts (30s for most, 120s for docker)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 04-programmatic-verifiers*
*Context gathered: 2026-03-05*
