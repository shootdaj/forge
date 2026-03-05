# Roadmap: Forge

## Overview

Forge is built bottom-up following its dependency chain: validate the SDK API surface first (the entire system depends on it), then lay foundation (config, state), then build the core primitive (step runner + cost), then verification (the defense against stochastic failure), then lifecycle orchestration (phase runner), then the wave model (the key differentiator), then CLI (thin glue), then enhancement features. Each phase delivers a testable, complete capability that the next phase depends on.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: SDK Proof of Concept** - Validate Agent SDK API surface with working query() call, structured output, and cost extraction
- [x] **Phase 2: Foundation (Config + State)** - Project config loading with validation and crash-safe state persistence
- [x] **Phase 3: Step Runner + Cost Controller** - Core primitive wrapping query() with budget enforcement, error handling, and failure cascade
- [x] **Phase 4: Programmatic Verifiers** - Registry of deterministic code checks that run after every step
- [x] **Phase 5: Phase Runner + Plan Verification + Gap Closure** - Full phase lifecycle orchestration with checkpoints and resumability (completed 2026-03-05)
- [x] **Phase 6: Pipeline Controller (Wave Model)** - Wave model FSM with dependency graph, mock management, spec compliance, and human checkpoint (completed 2026-03-05)
- [ ] **Phase 7: CLI + Git + Testing Infrastructure** - User-facing commands, git workflow, and test traceability
- [ ] **Phase 8: Enhancement Layer** - Requirements gathering, UAT, Notion docs, and remaining v1 features

## Phase Details

### Phase 1: SDK Proof of Concept
**Goal**: Developers can make Agent SDK query() calls with correct configuration and extract structured, typed results
**Depends on**: Nothing (first phase)
**Requirements**: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05
**Success Criteria** (what must be TRUE):
  1. A query() call executes with systemPrompt preset, settingSources, and bypassPermissions and returns a result
  2. Structured JSON output can be extracted from query() responses using outputFormat with a defined schema
  3. Cost data (total_cost_usd) is extractable from SDK result messages
  4. SDK errors (network, auth, budget exceeded) are caught and categorized distinctly from successful results
  5. The POC documents every divergence between SPEC.md pseudocode and actual SDK behavior
**Plans**: Complete

Plans:
- [x] 01-01: SDK query wrapper with types, configuration, structured output, cost extraction, and error categorization

### Phase 2: Foundation (Config + State)
**Goal**: System loads validated project configuration and persists state that survives crashes and process restarts
**Depends on**: Phase 1
**Requirements**: CFG-01, CFG-02, CFG-03, STA-01, STA-02, STA-03, STA-04, STA-05
**Success Criteria** (what must be TRUE):
  1. forge.config.json is loaded on startup with Zod validation and sensible defaults for all options (model, budgets, retries, testing, parallelism)
  2. forge-state.json persists orchestrator state with snake_case keys and TypeScript reads/writes via camelCase properties
  3. State file survives simulated process crash (kill -9) and is readable on restart with no corruption
  4. Concurrent writes to state (simulated parallel phases) do not corrupt data (atomic write-rename with mutex)
  5. State tracks all required fields: wave, phases, services_needed, mock_registry, skipped_items, credentials, human_guidance, spec_compliance, uat_results, total_budget_used
**Plans**: Complete

Plans:
- [x] 02-01: Config module (schema, loader, validation, defaults, camelCase mapping)
- [x] 02-02: State module (schema, state-manager, atomic writes, mutex, crash safety)

### Phase 3: Step Runner + Cost Controller
**Goal**: System can execute individual Agent SDK query() calls with budget enforcement, cost tracking, error handling, and automatic retry cascade
**Depends on**: Phase 2
**Requirements**: STEP-01, STEP-02, STEP-03, STEP-04, STEP-05, STEP-06, COST-01, COST-02, COST-03, COST-04
**Success Criteria** (what must be TRUE):
  1. runStep() wraps a query() call, enforces per-step budget via maxBudgetUsd, runs a verification callback on the result, and returns typed output
  2. System refuses to start a step when total accumulated cost exceeds the project budget (hard stop)
  3. runStepWithCascade() retries a failed step up to 3 times with different approaches, then skips and flags, then stops -- each retry includes prior error context
  4. Cost is tracked per step and accumulated per phase, with the cost log queryable for any step or phase
  5. SDK errors (network, auth) are distinguished from step failures and are not retried
**Plans**: Complete

Plans:
- [x] 03-01: Step runner, cost controller, cascade, types, and full test suite

### Phase 4: Programmatic Verifiers
**Goal**: System can programmatically verify build artifacts through deterministic code checks, never relying on agent self-report
**Depends on**: Phase 3
**Requirements**: VER-01, VER-02, VER-03, VER-04, VER-05, VER-06, VER-07, VER-08, VER-09
**Success Criteria** (what must be TRUE):
  1. File verifier confirms expected files exist; test verifier runs test command and parses JSON output for pass/fail/pending counts (checking numPassed > 0 AND numFailed === 0)
  2. Typecheck verifier runs tsc --noEmit and reports errors; lint verifier runs lint command and reports errors
  3. Coverage verifier checks that new source files have corresponding test files; observability verifier checks health endpoint and structured logging
  4. Docker verifier runs docker compose smoke tests; deployment verifier checks Dockerfile builds and env var consistency
  5. All verifiers run in parallel (Promise.all) with Docker running after others pass, and results are aggregated into a single verification report
**Plans**: Complete

Plans:
- [x] 04-01: Types, utils, config schema update, and all 8 individual verifiers with unit tests
- [x] 04-02: Verifier registry (runAll), integration tests, and scenario tests

### Phase 5: Phase Runner + Plan Verification + Gap Closure
**Goal**: System can execute a complete phase lifecycle (context through docs) with plan verification gates, targeted gap closure, and checkpoint-based resumability
**Depends on**: Phase 4
**Requirements**: PHA-01, PHA-02, PHA-03, PHA-04, PHA-05, PHA-06, PHA-07, PHA-08, PHA-09, PHA-10, PHA-11, PHA-12, GAP-01, GAP-02, GAP-03
**Success Criteria** (what must be TRUE):
  1. Phase runner executes the full cycle: context gathering (gray areas, decisions in CONTEXT.md) -> plan creation (PLAN.md via GSD) -> plan verification -> execution -> verification -> gap closure -> docs
  2. Plan verification catches missing requirement coverage and missing test tasks, auto-injecting test tasks and re-planning when requirements are uncovered
  3. After execution, all programmatic verifiers run; test failures trigger root cause diagnosis that categorizes the failure and produces a targeted fix plan (not blind retry or full re-execution)
  4. Phase creates file-based checkpoints (CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md, GAPS.md) and resumes from last checkpoint on restart
  5. Gap closure executes only the targeted fix plan, then re-verifies only affected areas
**Plans**: 3 plans

Plans:
- [x] 05-01: Types, checkpoint module, and plan verification (pure functions)
- [x] 05-02: Substep implementations, prompt builders, main phase runner, and unit tests
- [x] 05-03: Integration and scenario tests (full requirement coverage)

### Phase 6: Pipeline Controller (Wave Model)
**Goal**: System can orchestrate multi-wave autonomous execution -- building with mocks, batching human needs into one checkpoint, swapping to real integrations, and converging on spec compliance
**Depends on**: Phase 5
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11, MOCK-01, MOCK-02, MOCK-03, MOCK-04
**Success Criteria** (what must be TRUE):
  1. Wave 1 executes all phases with mock external services following the interface/mock/real/factory pattern, tracking every mock in the mock registry
  2. Human checkpoint batches ALL needs (services needing credentials, skipped items needing guidance, deferred ideas) into ONE interruption
  3. Wave 2 uses the mock registry to systematically swap every mock for real implementations and runs integration tests; skipped items are addressed with user guidance
  4. Spec compliance loop (Wave 3+) verifies every requirement, fixes gaps, and checks convergence (gaps must decrease each round; stops if not converging)
  5. Dependency graph built from roadmap determines phase ordering via topological sort; after UAT passes, milestone audit and completion run
**Plans**: 4 plans

Plans:
- [x] 06-01-PLAN.md -- Pipeline types, dependency graph (topological sort), and mock manager
- [x] 06-02-PLAN.md -- Human checkpoint, spec compliance loop, and prompt builders
- [ ] 06-03-PLAN.md -- Pipeline controller FSM (main runPipeline orchestrator)
- [ ] 06-04-PLAN.md -- Integration and scenario tests (full requirement coverage)

### Phase 7: CLI + Git + Testing Infrastructure
**Goal**: Users can interact with Forge through CLI commands, code is managed with proper git workflow, and test traceability is maintained
**Depends on**: Phase 6
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, COST-05, GIT-01, GIT-02, GIT-03, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. forge init starts interactive requirements gathering; forge run executes full wave model autonomously; forge phase N runs a single phase; forge resume continues from checkpoint with env file and guidance
  2. forge status displays wave progress, phase status, services needed, skipped items, spec compliance state, and budget breakdown (per phase and total)
  3. Each phase executes on a phase-N branch with atomic commits including requirement IDs (feat(R1): ...), merged to main after verification
  4. TEST_GUIDE.md is created during scaffolding with requirement-to-test mapping and updated after every phase; every requirement maps to at least one test
  5. Testing methodology is injected into the target project's CLAUDE.md; test pyramid is enforced per phase (new code must have tests)
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD
- [ ] 07-03: TBD

### Phase 8: Enhancement Layer
**Goal**: Forge has deep requirements gathering, UAT as a final gate, and Notion documentation -- completing the full autonomous development lifecycle
**Depends on**: Phase 7
**Requirements**: REQ-01, REQ-02, REQ-03, REQ-04, DOC-01, DOC-02, DOC-03, DOC-04, UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06
**Success Criteria** (what must be TRUE):
  1. forge init gathers requirements interactively across 8 categories (Core, Data, Security, Integrations, Quality, Infrastructure, UX, Business) with structured R1/R2 format including acceptance criteria, edge cases, and compliance flags
  2. UAT spins up the full application via Docker after spec compliance passes and tests every user workflow end-to-end (web via headless browser, APIs via HTTP, CLIs via shell)
  3. UAT uses safety guardrails (sandbox credentials, local SMTP, test DB) and failure triggers gap closure with retry loop; UAT is the final gate before returning to user
  4. 8 mandatory Notion pages are created under user-provided parent page during init and updated per phase (Architecture, Data Flow, API Ref, Components, Dev Workflow, ADRs, Phase Reports)
  5. Phase reports in Notion include goals, test results, architecture changes, issues, and budget; final milestone docs published on completion
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. SDK Proof of Concept | 1/1 | Completed | 2026-03-05 |
| 2. Foundation (Config + State) | 2/2 | Completed | 2026-03-05 |
| 3. Step Runner + Cost Controller | 1/1 | Completed | 2026-03-05 |
| 4. Programmatic Verifiers | 2/2 | Completed | 2026-03-05 |
| 5. Phase Runner + Plan Verification + Gap Closure | 3/3 | Complete   | 2026-03-05 |
| 6. Pipeline Controller (Wave Model) | 4/4 | Complete   | 2026-03-05 |
| 7. CLI + Git + Testing Infrastructure | 0/? | Not started | - |
| 8. Enhancement Layer | 0/? | Not started | - |
