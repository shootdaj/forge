# Forge

## What This Is

Forge is an autonomous software development orchestrator built on the Claude Agent SDK. You give it a project spec, it gathers deep requirements interactively, then builds the entire production system — code, tests, CI/CD, observability, security, documentation — without coming back unless it genuinely needs a human (account creation, API keys, payments). It uses code-based orchestration, not prompt chaining, with programmatic verification at every step.

## Core Value

Every step verified by code, not agent self-report. Forge maximizes autonomous progress — it only stops when it genuinely needs a human.

## Current State

**Shipped:** v1.0 MVP (2026-03-08)
**Stats:** 25,933 LOC TypeScript, 697 tests, 86 commits, 200 files, 8 phases, 20 plans

**What works:**
- CLI with commands: init, run, phase, status, resume
- Wave model execution: Wave 1 (build with mocks) → Human Checkpoint → Wave 2 (real integration) → Wave 3+ (spec compliance) → UAT
- Step runner wrapping Agent SDK query() with budget enforcement, error handling, verification
- Phase runner: context → plan → verify plan → execute → test → gap closure → docs
- 8 programmatic verifiers (files, tests, typecheck, lint, coverage, observability, docker, deployment)
- Spec compliance loop with convergence checking
- State persistence across interruptions via forge-state.json
- Cost tracking per step, phase, wave, total with budget enforcement

**E2E validated:**
- Todo CLI app: 13 min, $3.12
- GitHub Wrapped Next.js app: 24 min, $5.46

## Requirements

### Validated (v1.0)

All 90 requirements shipped and validated. See [archived requirements](milestones/v1.0-REQUIREMENTS.md).

### Active

(None — next milestone not started)

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
| Code-based orchestration over prompt chaining | Eliminates stochastic failure modes (step skipping, hallucinated completion, error ignoring) | Validated — 8 phases built deterministically |
| Fresh context per step via separate query() calls | Prevents context accumulation and degradation | Validated — raw async iterator with 2-min inactivity timeout |
| Programmatic verification over agent self-report | StrongDM pattern — code checks are deterministic | Validated — 8 verifiers running in parallel |
| Wave model for execution | Maximizes autonomous progress, batches human needs | Validated — Wave 1→Checkpoint→Wave 2→Compliance→UAT |
| Mock strategy with interface/mock/real/factory | Clean separation, systematic swap in Wave 2 | Validated — MockManager with state-persisted registry |
| Batched spec compliance over per-requirement sessions | 1+ hour → 5 min for full compliance loop | Validated — single SDK session checks all requirements |
| Text JSON parsing over SDK StructuredOutput | SDK outputSchema fails with max_structured_output_retries | Validated — extractJsonVerdict/extractJsonVerdictArray |
| Raw async iterator over for-await on SDK stream | for-await blocks on iterator.return() at child process exit | Validated — manual next() with Promise.race timeout |

---
*Last updated: 2026-03-09 after v1.0 milestone completion*
