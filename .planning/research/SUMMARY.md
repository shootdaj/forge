# Project Research Summary

**Project:** Forge -- Dark Factory Orchestrator
**Domain:** Autonomous AI software development orchestrator (Level 4 coding agent)
**Researched:** 2026-03-05
**Confidence:** HIGH

## Executive Summary

Forge is a code-based pipeline orchestrator that wraps the Claude Agent SDK's `query()` function to autonomously build entire software systems from requirements. The research confirms this is a viable architecture with strong differentiation: no competitor combines structured requirements gathering, a wave model (build-with-mocks then batch human needs then integrate), and deterministic programmatic verification. The closest comparison is StrongDM's Attractor, which uses graph-based orchestration and LLM-evaluated goal gates; Forge's code-based orchestration and programmatic verification are architecturally more reliable. The Agent SDK is the correct foundation -- it provides Claude Code as a library with full tool access, structured outputs, cost tracking, and per-step budget enforcement.

The recommended approach is to build bottom-up following the dependency chain: Config/State (foundation) -> Step Runner (core primitive wrapping `query()`) -> Verifiers (programmatic checks) -> Phase Runner (lifecycle orchestration) -> Pipeline Controller (wave model FSM) -> CLI (user interface). The Step Runner is the single most critical component because it bridges deterministic orchestrator code with the stochastic Agent SDK. Every other component depends on it working correctly. Before writing any production code, a proof-of-concept must validate the actual SDK API surface, since the SPEC.md pseudocode diverges from the real SDK in several important ways (required `allowDangerouslySkipPermissions` flag, `systemPrompt` object format, `settingSources` default to empty).

The three highest risks are: (1) the circularity problem where the same model writes code and tests, creating shared blind spots that pass verification but produce incorrect systems -- mitigated by Forge's layered programmatic verification and UAT; (2) state corruption from concurrent phase execution where multiple `Promise.all` phases clobber each other's state writes -- mitigated by collecting results in memory and merging sequentially after all concurrent phases complete; and (3) mock drift where Wave 1 mocks diverge from real API behavior, causing Wave 2 integration failures -- mitigated by contract tests that verify both mock and real implementations satisfy identical interfaces and behavioral contracts.

## Key Findings

### Recommended Stack

The stack centers on the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` ^0.2.63) as the sole LLM interface, with Zod (^3.24, SDK peer dependency) for schema validation, Commander (^14) for CLI, tsup for building, and Vitest for testing. All choices are driven by the SDK's requirements and the project's nature as a Node.js CLI tool. See `.planning/research/STACK.md` for full details.

**Core technologies:**
- **Agent SDK** (`query()`): IS Claude Code as a library -- provides all file/bash/search tools, structured outputs, cost tracking, and permission control. One call per pipeline step with fresh context.
- **Zod** (^3.24): Required peer dependency of Agent SDK. Also used for config validation, state schemas, and `outputFormat` JSON schema generation.
- **Commander** (^14): Zero-dependency CLI framework. Handles Forge's 5 commands (init, run, phase, status, resume) with excellent TypeScript types.
- **tsup** (^8.5): Zero-config TypeScript bundler on esbuild. 100x faster than tsc for compilation. ESM-only output with shebang for direct execution.
- **Vitest** (^4.0): Native TypeScript/ESM test runner. 10-20x faster than Jest. `vi.mock()` for SDK mocking in unit tests.
- **execa** (^9.5): Safe child process execution for verifiers (npm test, tsc, docker compose, git).

**Critical SDK configuration (verified against official docs):**
- `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` -- both required for autonomous operation
- `systemPrompt: { type: "preset", preset: "claude_code" }` -- required for Claude Code tools and GSD skills
- `settingSources: ["user", "project", "local"]` -- required to load CLAUDE.md (defaults to empty array)
- `outputFormat: { type: "json_schema", schema: ... }` -- for typed structured outputs from agent steps

### Expected Features

See `.planning/research/FEATURES.md` for full analysis including competitor comparison.

**Must have (table stakes):**
- Autonomous code generation from spec (the core promise)
- Programmatic verification after every step (code checks, not self-report)
- Test generation alongside code (enforced test pyramid)
- State persistence and crash resumability (forge-state.json + file checkpoints)
- Cost/budget controls with hard stops (per-step, per-phase, total)
- Retry cascade (3x different approach -> skip and flag -> stop)
- Error context propagation into retries
- Mock/stub pattern for external services

**Should have (differentiators -- what makes Forge worth building):**
- Wave model execution (build-with-mocks -> ONE human checkpoint -> real integration -> compliance)
- Deep interactive requirements gathering (25+ topics, R1/R2 format)
- Spec compliance loop with convergence checking (gaps must decrease each round)
- Code-based orchestration (TypeScript, not prompts or graphs)
- Batched human checkpoint (one interruption, not many)
- Plan verification gates (validate plans before executing them)

**Defer to v1.x:**
- Interactive requirements gatherer (users can write REQUIREMENTS.md manually for v1)
- UAT as final gate (add after spec compliance loop works)
- Parallel phase execution (sequential works first)
- Root cause diagnosis in gap closure
- Requirement traceability matrix (TEST_GUIDE.md)
- GitHub Flow branching strategy

**Defer to v2+:**
- Notion documentation (MCP dependency, high complexity)
- Agent teams / multi-project
- Webhook/Slack notifications
- Holdout evaluation
- Web UI / dashboard (anti-feature: scope explosion)
- Plugin/extension system (premature abstraction)

### Architecture Approach

The architecture follows the orchestrator-worker pattern: a single long-lived Node.js process (Forge) dispatches focused work to ephemeral Agent SDK sessions via `query()`. Each session gets fresh context injected via the prompt -- the orchestrator code is the memory, not the agent's conversation history. Components are layered by dependency: foundation (Config, State) -> core primitive (Step Runner, Cost Controller) -> verification (Verifier Registry) -> lifecycle (Phase Runner, Plan Checker, Gap Closure) -> orchestration (Pipeline Controller, Dependency Graph, Mock Manager, Spec Compliance) -> interface (Human Checkpoint, CLI). See `.planning/research/ARCHITECTURE.md` for full component breakdown and data flow diagrams.

**Major components:**
1. **Step Runner** (`step-runner.ts`) -- Core primitive. Wraps single `query()` call with budget enforcement, error handling, cost tracking, and mandatory post-step verification callback. Everything depends on this.
2. **Verifier Registry** (`verifiers/`) -- Registry of programmatic checks (files exist, tests pass, typecheck clean, lint clean, coverage thresholds, Docker smoke). Run in parallel after every step.
3. **Phase Runner** (`phase-runner.ts`) -- Orchestrates single phase lifecycle: context -> plan -> verify-plan -> execute -> test -> gap-closure -> docs. Handles retry-then-skip cascade.
4. **Pipeline Controller** (`pipeline.ts`) -- Wave model FSM: INIT -> SCAFFOLDING -> WAVE_1 -> HUMAN_CHECKPOINT -> WAVE_2 -> WAVE_3_PLUS -> UAT -> FINISHING -> COMPLETED.
5. **State Manager** (`state.ts`) -- Durable state via forge-state.json with atomic write-rename pattern. Designed for concurrent access from day one.
6. **Cost Controller** (`cost.ts`) -- Pre-step budget check with dynamic per-step cap reduction as total approaches limit. Tracks cost from `SDKResultMessage.total_cost_usd`.

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for the complete list of 10 pitfalls with recovery strategies.

1. **Circularity problem (same model writes code and tests)** -- Programmatic verification is the primary defense. Verifiers must check REAL outcomes (exit codes, file parsing, HTTP responses), never agent self-report. UAT provides external behavioral validation. Consider holdout acceptance criteria not shown to the building agent.
2. **State corruption from concurrent phase writes** -- Use atomic write-rename for all state I/O. Concurrent phases collect results in memory, merge sequentially AFTER all complete. File-based locking or in-memory mutex for state writes.
3. **Mock drift in Wave 2** -- Build contract tests alongside mocks. Verify both mock and real implementations satisfy identical interfaces AND behavioral contracts. Tag mock limitations explicitly.
4. **SDK process spawn overhead (~12s per query)** -- Accept as fixed cost. Design step granularity for fewer, larger steps rather than many tiny ones. Consider batching related substeps into single `query()` calls where appropriate.
5. **Verification that doesn't actually verify** -- Layer verification: existence AND content AND behavior. Parse test JSON output fully (check numPassedTests > 0, not just numFailedTests === 0). Build "verifier tests" that intentionally break code and confirm verifiers catch it.

## Implications for Roadmap

Based on the dependency graph between components and the build order analysis from architecture research, here is the suggested phase structure:

### Phase 0: SDK Proof of Concept
**Rationale:** The CLAUDE.md build strategy mandates this. The SPEC.md pseudocode diverges from the real SDK API in several ways. Building without validating the SDK first risks cascading failures. This is a day-one blocker.
**Delivers:** Working `query()` call with correct options (bypassPermissions, systemPrompt preset, settingSources), cost extraction from `SDKResultMessage`, session ID capture, structured output via `outputFormat`, error handling for all result subtypes.
**Addresses:** Pitfall 10 (spec vs SDK mismatch)
**Avoids:** Building on assumptions about an unstable API

### Phase 1: Foundation (Config + State)
**Rationale:** Every component depends on config loading and state persistence. State must be designed for concurrent access from day one (Pitfall 3).
**Delivers:** Config loader with Zod validation, state manager with atomic write-rename, camelCase/snake_case serialization, crash-safe persistence.
**Addresses:** State persistence (table stakes), crash recovery foundation
**Avoids:** Pitfall 3 (state corruption), Pitfall 8 (crash recovery)

### Phase 2: Step Runner + Cost Controller
**Rationale:** The Step Runner is the most critical component -- every other component depends on it. The cost controller is tightly coupled (budget check before every query call).
**Delivers:** `runStep()` wrapping `query()` with budget enforcement, error handling for all SDK result subtypes, cost tracking, session ID capture, mandatory verification callback. `runStepWithCascade()` for retry-then-skip.
**Addresses:** Autonomous code generation, cost/budget controls, retry cascade, error context propagation
**Avoids:** Pitfall 1 (process spawn overhead -- step granularity decisions here), Pitfall 4 (budget gap -- dynamic per-step cap), Pitfall 7 (permissions -- configurable per step type)

### Phase 3: Programmatic Verifiers
**Rationale:** Verification is the second most critical piece. Without it, autonomy is reckless. Must be built before Phase Runner since phase lifecycle depends on verification.
**Delivers:** Verifier registry with parallel execution. Individual verifiers: file existence + content validation, test runner JSON parsing (numPassed > 0 AND numFailed === 0 AND numPending === 0), typecheck (tsc --noEmit), lint (eslint), coverage thresholds, Docker smoke test.
**Addresses:** Programmatic verification (table stakes), test generation verification
**Avoids:** Pitfall 2 (circularity -- verifiers are the defense), Pitfall 6 (shallow verification -- layered checks)

### Phase 4: Phase Runner + Plan Checker + Gap Closure
**Rationale:** The phase lifecycle (context -> plan -> verify-plan -> execute -> test -> gap-closure -> docs) is the orchestration layer that uses Step Runner and Verifiers. This is the second most complex component.
**Delivers:** Full phase lifecycle execution with file-based checkpoints for resumability. Plan checker validates requirement coverage and test task presence. Gap closure with error context propagation. Phase-level state tracking.
**Addresses:** Phase execution, plan verification gates, retry with different approaches, state persistence at phase level
**Avoids:** Pitfall 9 (context exhaustion -- phases decomposed into appropriately-sized steps)

### Phase 5: Pipeline Controller (Wave Model FSM)
**Rationale:** The wave model requires Phase Runner to be working. This is the most complex component and Forge's key differentiator. Includes dependency graph, mock manager, and human checkpoint.
**Delivers:** Wave model FSM (INIT through COMPLETED), dependency graph from ROADMAP.md with topological sort, mock registry with systematic swap, batched human checkpoint, spec compliance loop with convergence checking.
**Addresses:** Wave model execution (differentiator), mock strategy, batched human checkpoint, spec compliance loop
**Avoids:** Pitfall 5 (mock drift -- contract test infrastructure), Pitfall 3 (state corruption -- sequential merge after concurrent phases)

### Phase 6: CLI Entry Point
**Rationale:** The CLI wires everything together. Depends on all previous phases. Simple Commander.js implementation.
**Delivers:** `forge init`, `forge run`, `forge phase`, `forge status`, `forge resume` commands. Status reporting. Resume from human checkpoint with env file and guidance.
**Addresses:** CLI interface (table stakes)

### Phase 7: Enhancement Layer (v1.x features)
**Rationale:** These features improve quality and UX but are not required for the core pipeline to function. Build after the sequential pipeline works end-to-end.
**Delivers:** Interactive requirements gatherer, UAT runner, parallel phase execution, root cause diagnosis, requirement traceability (TEST_GUIDE.md), GitHub Flow branching.
**Addresses:** P2 features from prioritization matrix

### Phase Ordering Rationale

- **Bottom-up by dependency chain:** Each layer can be integration-tested before building the next. Config/State -> Step Runner -> Verifiers -> Phase Runner -> Pipeline Controller -> CLI follows the strict dependency ordering from architecture research.
- **POC first:** Validating the SDK API surface before writing production code prevents the cascading failure described in Pitfall 10. This is non-negotiable.
- **Verifiers before Phase Runner:** Phase Runner calls verifiers after every step. Building verifiers first means Phase Runner can be tested with real verification from day one.
- **Sequential pipeline before parallel:** The architecture research explicitly recommends sequential execution first, with parallelism as a Phase 7 optimization. This avoids Pitfall 3 until the state management is battle-tested.
- **CLI last (among core phases):** The CLI is thin glue. Everything it calls must work before wiring it up.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 0 (SDK POC):** Must verify against live SDK. The V2 preview API (`unstable_v2_createSession`) is labeled unstable and may change. Confirm `bypassPermissions` + `allowDangerouslySkipPermissions` works as documented.
- **Phase 5 (Pipeline Controller):** The wave model is novel -- no competitor has this exact pattern. Dependency graph topological sort is standard, but the mock-to-real swap lifecycle and convergence checking in the spec compliance loop need careful design.
- **Phase 7 (UAT Runner):** Application-type-specific testing (browser automation for web, HTTP for API, shell for CLI) requires research into current headless browser options and test harness patterns.

Phases with well-documented patterns (skip deep research):
- **Phase 1 (Config + State):** Standard JSON config loading with Zod validation, atomic file writes. Well-trodden territory.
- **Phase 3 (Verifiers):** Each verifier is a pure function: run a command, parse output, return pass/fail. Standard patterns.
- **Phase 6 (CLI):** Commander.js has extensive documentation and 500M+ weekly downloads.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Agent SDK docs verified against official platform.claude.com (2026-03-05). All library choices verified on npm with active maintenance and significant adoption. |
| Features | HIGH | Core features well-understood from SPEC.md. Competitor analysis covers Devin, Cursor, Codex, Attractor, and Kiro with mix of official and third-party sources. |
| Architecture | HIGH | Orchestrator-worker pattern is well-established. Component boundaries derived from SPEC.md dependency analysis. Agent SDK integration patterns verified against official docs. |
| Pitfalls | HIGH | SDK pitfalls verified via official docs and GitHub issues. Circularity problem documented by StrongDM. State corruption and budget gap issues are standard distributed systems concerns. |

**Overall confidence:** HIGH

### Gaps to Address

- **V2 SDK stability:** The `unstable_v2_createSession` API is labeled unstable. If it changes before Forge ships, the interactive requirements gathering mode will need to use V1 `query()` with streaming input (`AsyncIterable<SDKUserMessage>`) instead. Monitor SDK changelog.
- **Subagent permission inheritance:** SDK issue #20264 confirms subagents inherit `bypassPermissions` and it cannot be overridden. This means verification steps using subagents cannot be sandboxed. Workaround: use `disallowedTools` to block specific tools, or run verification as a separate `query()` call with different permission mode.
- **Cost tracking deduplication:** Parallel tool calls within a single query may produce duplicate usage data. The correct deduplication strategy (by message ID) needs validation against the live SDK.
- **Concurrent phase Git isolation:** Running phases concurrently on the same repo creates Git conflict risk. Git worktrees are the standard solution but add complexity. Defer to Phase 7 (parallelism) and validate approach then.
- **Extended thinking budget behavior:** The SDK docs note `maxBudgetUsd` is "a target rather than a strict limit" for extended thinking. Real-world budget overrun characteristics need empirical measurement during Phase 0 POC.

## Sources

### Primary (HIGH confidence)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full API, options, message types, cost tracking
- [Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) -- Permission modes, `allowDangerouslySkipPermissions`
- [Agent SDK Structured Outputs](https://platform.claude.com/docs/en/agent-sdk/structured-outputs) -- `outputFormat`, Zod integration
- [StrongDM Attractor](https://github.com/strongdm/attractor) -- Graph-based orchestration, circularity problem, convergence patterns
- [Cognition Devin 2.0](https://cognition.ai/blog/devin-2) -- Competitor feature baseline
- [Cursor Cloud Agents](https://cursor.com/blog/scaling-agents) -- Competitor architecture
- [OpenAI Codex](https://openai.com/index/introducing-codex/) -- Competitor sandbox model
- [Kiro](https://kiro.dev/) -- Spec-driven development comparison

### Secondary (MEDIUM confidence)
- [Simon Willison on StrongDM Dark Factory](https://simonwillison.net/2026/Feb/7/software-factory/) -- Level 4 coding lessons learned
- [Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- Unstable multi-turn API
- [Dark Factory Architecture Patterns](https://www.infralovers.com/blog/2026-02-22-architektur-patterns-dark-factory/) -- Industry patterns
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- Orchestrator-worker pattern

### Tertiary (LOW confidence)
- [SDK Issue #34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) -- ~12s cold start (community report, not official benchmark)
- [Partial Success in DAG Systems](https://medium.com/@kriyanshii/understanding-partial-success-in-dag-systems-building-resilient-workflows-977de786100f) -- Skip-and-flag pattern

---
*Research completed: 2026-03-05*
*Ready for roadmap: yes*
