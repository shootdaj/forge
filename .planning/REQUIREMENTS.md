# Requirements: Forge

**Defined:** 2026-03-05
**Core Value:** Every step verified by code, not agent self-report. Forge maximizes autonomous progress.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### SDK Integration

- [x] **SDK-01**: System can call Agent SDK query() with fresh context per step and receive typed messages
- [x] **SDK-02**: System configures systemPrompt preset for Claude Code behavior and GSD skill availability
- [x] **SDK-03**: System configures settingSources to load CLAUDE.md and project settings
- [x] **SDK-04**: System operates in bypassPermissions mode with allowDangerouslySkipPermissions for autonomous execution
- [x] **SDK-05**: System extracts structured output from query() responses using outputFormat with JSON schema

### Configuration

- [x] **CFG-01**: User can define project config in forge.config.json (model, budgets, retries, testing, parallelism, Notion, deployment)
- [x] **CFG-02**: System loads and validates config on startup with sensible defaults
- [x] **CFG-03**: Config supports all options from spec: model, max_budget_total, max_budget_per_step, max_retries, max_compliance_rounds, max_turns_per_step, testing commands, verification toggles, parallelism settings

### State Management

- [x] **STA-01**: System persists orchestrator state to forge-state.json with snake_case keys
- [x] **STA-02**: TypeScript runtime maps camelCase properties to snake_case JSON via serialization layer
- [x] **STA-03**: State tracks: wave, phases, services_needed, mock_registry, skipped_items, credentials, human_guidance, spec_compliance, uat_results, total_budget_used
- [x] **STA-04**: State survives process crashes and can be resumed from last checkpoint
- [x] **STA-05**: Concurrent state writes are safe (atomic write-rename pattern with mutex for parallel phases)

### Step Runner

- [x] **STEP-01**: runStep() wraps a single query() call with budget enforcement, error handling, and verification callback
- [x] **STEP-02**: System checks total budget before starting each step and hard-stops if exceeded
- [x] **STEP-03**: System tracks cost per step via SDK's total_cost_usd and updates cumulative budget
- [x] **STEP-04**: runStepWithCascade() implements failure cascade: retry 3x with different approaches, then skip and flag, then stop
- [x] **STEP-05**: Per-step budget exceeded mid-execution is treated as partial completion (run verification to check what got done)
- [x] **STEP-06**: SDK errors (network, auth) are not retried — logged and returned as failed

### Programmatic Verifiers

- [x] **VER-01**: Files verifier checks expected files exist via fs.existsSync()
- [x] **VER-02**: Tests verifier runs test command, parses JSON output for pass/fail counts
- [x] **VER-03**: Typecheck verifier runs tsc --noEmit and reports errors
- [x] **VER-04**: Lint verifier runs lint command and reports errors
- [x] **VER-05**: Test coverage verifier checks new source files have corresponding test files
- [x] **VER-06**: Observability verifier checks health endpoint, structured logging, error logging
- [x] **VER-07**: Docker verifier runs docker compose smoke tests
- [x] **VER-08**: Deployment verifier checks Dockerfile builds, env vars consistent, deploy config valid
- [x] **VER-09**: All verifiers run in parallel (Promise.all), docker runs after others pass

### Phase Runner

- [x] **PHA-01**: Phase runner executes full cycle: context -> plan -> verify plan -> execute -> test -> gap closure -> docs
- [x] **PHA-02**: Context gathering detects gray areas, locks decisions in CONTEXT.md, captures deferred ideas
- [x] **PHA-03**: Plan creation via GSD plan-phase, produces PLAN.md
- [x] **PHA-04**: Plan verification checks requirement coverage, test task presence, execution order, success criteria, no scope creep
- [x] **PHA-05**: Missing test tasks are injected into plan automatically (deterministic code edit)
- [x] **PHA-06**: Missing requirement coverage triggers re-planning with specific feedback
- [x] **PHA-07**: Execution runs with mock instructions for external services + failure cascade
- [x] **PHA-08**: After execution, all programmatic verifiers run
- [x] **PHA-09**: Test failures trigger root cause diagnosis -> targeted fix plan -> execute fix (not blind retry)
- [x] **PHA-10**: Test coverage gaps trigger gsd:add-tests to generate missing tests
- [x] **PHA-11**: Phase creates file-based checkpoints (CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md, GAPS.md)
- [x] **PHA-12**: Phase runner resumes from last checkpoint on restart (skip completed substeps)

### Pipeline Controller (Wave Model)

- [x] **PIPE-01**: Wave 1 builds everything possible — GSD new-project, scaffolding, all phases with mocks
- [x] **PIPE-02**: External services detected from phase descriptions and built with mock pattern (interface/mock/real/factory)
- [x] **PIPE-03**: Mock registry tracks all mocked files precisely for systematic swap
- [x] **PIPE-04**: Human checkpoint batches ALL needs: services + skipped items + deferred ideas in ONE interruption
- [x] **PIPE-05**: Wave 2 swaps mocks for real implementations using mock registry, runs integration tests
- [x] **PIPE-06**: Wave 2 addresses skipped items with user guidance
- [x] **PIPE-07**: Wave 3+ runs spec compliance loop: verify every requirement, fix gaps, converge
- [x] **PIPE-08**: Spec compliance checks convergence — gaps must decrease each round; stops if not converging
- [x] **PIPE-09**: After spec compliance, runs UAT as final gate
- [x] **PIPE-10**: After UAT passes, runs gsd:audit-milestone and gsd:complete-milestone
- [x] **PIPE-11**: Dependency graph built from roadmap for phase ordering (topological sort)

### CLI

- [x] **CLI-01**: forge init — interactive requirements gathering across 25+ topics with structured R1/R2 format
- [x] **CLI-02**: forge run — executes full wave model autonomously
- [x] **CLI-03**: forge phase N — runs single phase through full cycle
- [x] **CLI-04**: forge status — displays wave, phase progress, services, skipped items, spec compliance, budget
- [x] **CLI-05**: forge resume --env .env.production [--guidance guidance.md] — continues from checkpoint with credentials and guidance

### Cost Control

- [x] **COST-01**: Per-step budget via maxBudgetUsd on each query() call
- [x] **COST-02**: Total project budget hard stop checked before every step
- [x] **COST-03**: Per-phase budget tracked (sum of steps)
- [x] **COST-04**: Cost logged per step for full visibility
- [x] **COST-05**: forge status displays budget breakdown (per phase, total)

### Testing Infrastructure

- [x] **TEST-01**: Testing methodology injected into project's CLAUDE.md during scaffolding
- [x] **TEST-02**: TEST_GUIDE.md created with requirement-to-test mapping (traceability matrix)
- [x] **TEST-03**: TEST_GUIDE.md updated after every phase with new test mappings
- [x] **TEST-04**: Every requirement must map to at least one test at each tier (unit/integration/scenario)
- [x] **TEST-05**: Test pyramid enforced per phase: new code must have tests, test count must increase

### Gap Closure

- [x] **GAP-01**: Root cause diagnosis categorizes failures: wrong approach, missing dependency, integration mismatch, requirement ambiguity, environment issue
- [x] **GAP-02**: Targeted fix plan created based on diagnosis (specific files, specific fix, specific retest)
- [x] **GAP-03**: Only the fix plan is executed, not the entire phase again

### External Service Mocking

- [x] **MOCK-01**: Every mocked service follows pattern: interface + mock + real + factory + FORGE:MOCK tag
- [x] **MOCK-02**: Mock registry in state tracks all mocked files precisely
- [x] **MOCK-03**: Wave 2 uses mock registry to systematically swap every mock
- [x] **MOCK-04**: Mock and real implementations satisfy same TypeScript interface

### Git Integration

- [x] **GIT-01**: Atomic commits include requirement IDs (feat(R1): ...)
- [x] **GIT-02**: GitHub Flow: branch protection on main, phase branches, atomic merges
- [x] **GIT-03**: Each phase executes on phase-N branch, merged to main after verification

### Notion Documentation

- [x] **DOC-01**: 8 mandatory Notion pages created under user-provided parent page during init
- [x] **DOC-02**: Pages updated per phase: Architecture, Data Flow, API Ref, Components, Dev Workflow, ADRs, Phase Reports
- [x] **DOC-03**: Phase reports include: goals, test results, architecture changes, issues, budget
- [x] **DOC-04**: Final milestone docs published on completion

### User Acceptance Testing

- [ ] **UAT-01**: Full application spun up via Docker after spec compliance passes
- [ ] **UAT-02**: Every user workflow from requirements tested end-to-end
- [ ] **UAT-03**: Web apps tested via headless browser, APIs via HTTP, CLIs via shell
- [ ] **UAT-04**: Safety guardrails: sandbox credentials, local SMTP, test DB — never production
- [ ] **UAT-05**: UAT failure triggers gap closure -> retry UAT loop
- [ ] **UAT-06**: UAT is the final gate — only return to user after UAT passes or not converging

### Requirements Gathering

- [x] **REQ-01**: forge init gathers requirements across 8 categories (Core, Data, Security, Integrations, Quality, Infrastructure, UX, Business)
- [x] **REQ-02**: Each requirement gets structured format: ID, description, acceptance criteria, edge cases, performance, security, observability
- [x] **REQ-03**: Requirements produce REQUIREMENTS.md with numbered R1, R2, ... format
- [x] **REQ-04**: Compliance flags (SOC 2, HIPAA, GDPR, PCI DSS, WCAG) drive specific build requirements

## v2 Requirements

### Advanced Parallelism

- **PAR-01**: Within-phase subagents for parallel task groups (backend + frontend concurrent)
- **PAR-02**: Across-phase concurrent query() calls (max 3 concurrent)
- **PAR-03**: Git conflict resolution agent for concurrent phase work

### Enhanced Reporting

- **RPT-01**: Webhook/Slack notifications for human checkpoint and completion
- **RPT-02**: Live dashboard showing wave progress, costs, spec compliance
- **RPT-03**: Cost-per-requirement analysis

### Advanced Features

- **ADV-01**: Agent Teams for cross-repo / multi-project parallelism
- **ADV-02**: Holdout evaluation (separate AI reviews against requirements)
- **ADV-03**: Multiple concurrent projects
- **ADV-04**: Post-phase retrospective and pattern analysis
- **ADV-05**: Mobile app UAT (React Native/Flutter emulator testing)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI / dashboard | CLI tool for developers; web UI quadruples scope |
| Model-agnostic support | Built on Claude Agent SDK; supporting other models means rebuilding tool ecosystem |
| Real-time streaming UI | Forge runs unattended by design |
| Plugin/extension system | Premature abstraction; stabilize verifiers and pipeline first |
| Learning across projects | Massive scope increase for uncertain value; StrongDM doesn't do this |
| Deployment to production | Autonomous deployment of autonomous code is a liability; human gate is a feature |
| Agent-authored code reviews | Redundant with programmatic verification pipeline |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SDK-01 | Phase 1 | **Delivered** |
| SDK-02 | Phase 1 | **Delivered** |
| SDK-03 | Phase 1 | **Delivered** |
| SDK-04 | Phase 1 | **Delivered** |
| SDK-05 | Phase 1 | **Delivered** |
| CFG-01 | Phase 2 | **Delivered** |
| CFG-02 | Phase 2 | **Delivered** |
| CFG-03 | Phase 2 | **Delivered** |
| STA-01 | Phase 2 | **Delivered** |
| STA-02 | Phase 2 | **Delivered** |
| STA-03 | Phase 2 | **Delivered** |
| STA-04 | Phase 2 | **Delivered** |
| STA-05 | Phase 2 | **Delivered** |
| STEP-01 | Phase 3 | **Delivered** |
| STEP-02 | Phase 3 | **Delivered** |
| STEP-03 | Phase 3 | **Delivered** |
| STEP-04 | Phase 3 | **Delivered** |
| STEP-05 | Phase 3 | **Delivered** |
| STEP-06 | Phase 3 | **Delivered** |
| COST-01 | Phase 3 | **Delivered** |
| COST-02 | Phase 3 | **Delivered** |
| COST-03 | Phase 3 | **Delivered** |
| COST-04 | Phase 3 | **Delivered** |
| VER-01 | Phase 4 | **Delivered** |
| VER-02 | Phase 4 | **Delivered** |
| VER-03 | Phase 4 | **Delivered** |
| VER-04 | Phase 4 | **Delivered** |
| VER-05 | Phase 4 | **Delivered** |
| VER-06 | Phase 4 | **Delivered** |
| VER-07 | Phase 4 | **Delivered** |
| VER-08 | Phase 4 | **Delivered** |
| VER-09 | Phase 4 | **Delivered** |
| PHA-01 | Phase 5 | **Delivered** |
| PHA-02 | Phase 5 | **Delivered** |
| PHA-03 | Phase 5 | **Delivered** |
| PHA-04 | Phase 5 | **Delivered** |
| PHA-05 | Phase 5 | **Delivered** |
| PHA-06 | Phase 5 | **Delivered** |
| PHA-07 | Phase 5 | **Delivered** |
| PHA-08 | Phase 5 | **Delivered** |
| PHA-09 | Phase 5 | **Delivered** |
| PHA-10 | Phase 5 | **Delivered** |
| PHA-11 | Phase 5 | **Delivered** |
| PHA-12 | Phase 5 | **Delivered** |
| GAP-01 | Phase 5 | **Delivered** |
| GAP-02 | Phase 5 | **Delivered** |
| GAP-03 | Phase 5 | **Delivered** |
| PIPE-01 | Phase 6 | Complete |
| PIPE-02 | Phase 6 | Complete |
| PIPE-03 | Phase 6 | Complete |
| PIPE-04 | Phase 6 | Complete |
| PIPE-05 | Phase 6 | Complete |
| PIPE-06 | Phase 6 | Complete |
| PIPE-07 | Phase 6 | Complete |
| PIPE-08 | Phase 6 | Complete |
| PIPE-09 | Phase 6 | Complete |
| PIPE-10 | Phase 6 | Complete |
| PIPE-11 | Phase 6 | Complete |
| MOCK-01 | Phase 6 | Complete |
| MOCK-02 | Phase 6 | Complete |
| MOCK-03 | Phase 6 | Complete |
| MOCK-04 | Phase 6 | Complete |
| CLI-01 | Phase 7 | Complete |
| CLI-02 | Phase 7 | Complete |
| CLI-03 | Phase 7 | Complete |
| CLI-04 | Phase 7 | Complete |
| CLI-05 | Phase 7 | Complete |
| COST-05 | Phase 7 | Complete |
| GIT-01 | Phase 7 | Complete |
| GIT-02 | Phase 7 | Complete |
| GIT-03 | Phase 7 | Complete |
| TEST-01 | Phase 7 | Complete |
| TEST-02 | Phase 7 | Complete |
| TEST-03 | Phase 7 | Complete |
| TEST-04 | Phase 7 | Complete |
| TEST-05 | Phase 7 | Complete |
| REQ-01 | Phase 8 | Complete |
| REQ-02 | Phase 8 | Complete |
| REQ-03 | Phase 8 | Complete |
| REQ-04 | Phase 8 | Complete |
| DOC-01 | Phase 8 | Complete |
| DOC-02 | Phase 8 | Complete |
| DOC-03 | Phase 8 | Complete |
| DOC-04 | Phase 8 | Complete |
| UAT-01 | Phase 8 | Pending |
| UAT-02 | Phase 8 | Pending |
| UAT-03 | Phase 8 | Pending |
| UAT-04 | Phase 8 | Pending |
| UAT-05 | Phase 8 | Pending |
| UAT-06 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 90 total
- Mapped to phases: 90
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after roadmap creation*
