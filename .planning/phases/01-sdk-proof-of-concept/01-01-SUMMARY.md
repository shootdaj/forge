---
phase: 01-sdk-proof-of-concept
plan: 01
subsystem: sdk
tags: [claude-agent-sdk, query, structured-output, cost-extraction]

# Dependency graph
requires: []
provides:
  - executeQuery() wrapper around Agent SDK query()
  - System prompt preset configuration (claude_code)
  - Settings sources loading (user, project, local)
  - Cost extraction from SDK result messages (total_cost_usd)
  - SDK error categorization (network, auth, budget exceeded)
  - Inactivity timeout with raw async iterator pattern
affects: [02-foundation-config-state, phase-3]

# Tech tracking
tech-stack:
  added: [@anthropic-ai/claude-agent-sdk]
  patterns: [raw-async-iterator, inactivity-timeout, env-unset-CLAUDECODE]

key-files:
  created:
    - src/sdk/query-wrapper.ts
    - src/sdk/types.ts
    - src/sdk/index.ts

# Summary

Implemented the SDK query wrapper that serves as the foundation for all agent interactions. Key decisions:

1. Uses raw async iterator (NOT `for await`) to avoid `iterator.return()` blocking on child process exit
2. Inactivity timeout via `Promise.race` to detect stuck sessions
3. Must unset `CLAUDECODE` env var when running from within Claude Code to prevent nested session detection
4. SDK's `outputSchema` (StructuredOutput) is unreliable — use text JSON parsing instead
5. Documented all divergences between SPEC.md pseudocode and actual SDK behavior in DIVERGENCES.md
