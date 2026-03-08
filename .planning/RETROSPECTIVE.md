# Retrospective: v1.0 MVP

**Shipped:** 2026-03-08
**Duration:** 5 days (2026-03-03 to 2026-03-08)
**Scope:** 8 phases, 20 plans, 90 requirements

## What Went Well

- **Bottom-up build order** worked perfectly — SDK POC first caught 6+ API divergences before any application code was written
- **Programmatic verification** caught real bugs that agent self-report would have missed (test failures, type errors, missing files)
- **Batched spec compliance** turned a 1+ hour per-requirement loop into a 5-minute single-session check
- **E2E validation on real projects** (Todo CLI, GitHub Wrapped) proved the system works end-to-end

## What Was Painful

- **SDK StructuredOutput** (`outputSchema`) failed with `error_max_structured_output_retries` — had to switch to text JSON parsing mid-build
- **`for await` on SDK message stream** blocked on `iterator.return()` when breaking — required switching to raw async iterator
- **Running Forge inside Claude Code** caused nested session detection — required `env -u CLAUDECODE` workaround
- **Early phases (1-3) built without PLAN/SUMMARY artifacts** — caused GSD tracking to see them as incomplete later

## Key Learnings

1. SDK APIs labeled "unstable" will break — always build a proof-of-concept first
2. Raw async iterators with inactivity timeouts are more reliable than for-await for streaming
3. Text JSON parsing is more robust than structured output schemas for LLM responses
4. Crash-safe state (atomic write-rename + mutex) is essential for long-running autonomous processes
5. Convergence checking prevents infinite compliance loops — must track gap count trend

## Metrics

| Metric | Value |
|--------|-------|
| LOC | 25,933 |
| Tests | 697 |
| Commits | 86 |
| Files | 200 |
| E2E: Todo CLI | 13 min, $3.12 |
| E2E: GitHub Wrapped | 24 min, $5.46 |
