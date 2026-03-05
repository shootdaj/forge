# Forge

## What This Is

Forge is an autonomous software development orchestrator built on the Claude Agent SDK. You give it a project spec, it gathers deep requirements interactively, then builds the entire production system — code, tests, CI/CD, observability, security, documentation — without coming back unless it genuinely needs a human (account creation, API keys, payments). It uses code-based orchestration, not prompt chaining, with programmatic verification at every step.

## Core Value

Every step verified by code, not agent self-report. Forge maximizes autonomous progress — it only stops when it genuinely needs a human.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] CLI with commands: init, run, phase, status, resume
- [ ] Interactive requirements gathering (forge init) across 25+ topics with structured R1, R2 format
- [ ] Wave model execution: Wave 1 (build with mocks) → Human Checkpoint → Wave 2 (real integration) → Wave 3+ (spec compliance) → UAT
- [ ] Step runner wrapping Agent SDK query() with budget enforcement, error handling, verification
- [ ] Phase runner: context → plan → verify plan → execute → test → gap closure → docs
- [ ] Programmatic verifiers: files, tests, typecheck, lint, test-coverage, observability, docker, deployment
- [ ] External service mock strategy: interface/mock/real/factory pattern with mock registry
- [ ] Spec compliance loop with convergence checking
- [ ] User Acceptance Testing (UAT) as final gate
- [ ] State persistence across interruptions via forge-state.json + file-based phase checkpoints
- [ ] Cost tracking per step, phase, wave, total with budget enforcement
- [ ] Batched human checkpoint (services + skipped items + deferred ideas)
- [ ] Notion documentation: 8 mandatory pages created/updated per phase
- [ ] TEST_GUIDE.md traceability matrix: every requirement mapped to tests
- [ ] Plan verification gates: requirement coverage, test tasks, execution order, success criteria
- [ ] Gap closure with root cause diagnosis → targeted fix plan
- [ ] Atomic commits with requirement IDs (feat(R1): ...)
- [ ] GitHub Flow: branch protection, phase branching, atomic merges
- [ ] Parallelism: independent phases concurrent, verification parallel, background docs
- [ ] Failure cascade: retry(3x) → skip and flag → stop
- [ ] forge resume with credentials + guidance for skipped items

### Out of Scope

- Frontend / web UI — CLI only
- Database — file-based state (forge-state.json)
- Agent Teams / multi-project — v2
- Holdout evaluation — v2
- Webhook/Slack notifications — v2
- Live dashboard — v2
- Deployment automation (push to prod) — v2
- Learning across projects — v2
- Mobile app UAT (React Native/Flutter emulators) — v2

## Context

- Core dependency: `@anthropic-ai/claude-agent-sdk` (Claude Code as a library)
- The SDK has breaking changes from what SPEC.md pseudocode assumes:
  - Must set `systemPrompt: { type: "preset", preset: "claude_code" }` for CC behavior
  - Must set `settingSources: ["user", "project", "local"]` for GSD skills
  - Verify exact `permissionMode` values against SDK docs
- SPEC.md code blocks are pseudocode — implement the behavior, not the syntax
- GSD skills called directly via query() — no AX layer
- StrongDM's Attractor is the reference implementation (Level 4 autonomous coding)
- The spec at SPEC.md is the source of truth for all architecture and behavior

## Constraints

- **Tech stack**: Node.js / TypeScript, CLI tool
- **Core dependency**: @anthropic-ai/claude-agent-sdk — must research actual API surface before coding
- **State format**: JSON with snake_case keys, TypeScript uses camelCase via serialization layer
- **Config**: forge.config.json (project config), forge-state.json (runtime state)
- **Testing**: Unit tests for pure logic, integration tests mocking query() to avoid burning tokens

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Code-based orchestration over prompt chaining | Eliminates stochastic failure modes (step skipping, hallucinated completion, error ignoring) | — Pending |
| Fresh context per step via separate query() calls | Prevents context accumulation and degradation | — Pending |
| Programmatic verification over agent self-report | StrongDM pattern — code checks are deterministic | — Pending |
| Wave model for execution | Maximizes autonomous progress, batches human needs | — Pending |
| Mock strategy with interface/mock/real/factory | Clean separation, systematic swap in Wave 2 | — Pending |

---
*Last updated: 2026-03-05 after initialization*
