---
phase: 02-foundation-config-state
plan: 02
subsystem: state
tags: [zod, state, atomic-writes, mutex, crash-safety, snake-case]

# Dependency graph
requires:
  - phase: 02-01
    provides: Config schema and loader
provides:
  - StateManager with atomic write-rename pattern
  - Promise-based mutex for concurrent write protection
  - snake_case JSON / camelCase TypeScript bidirectional mapping
  - Zod validation for all state fields
  - forge-state.json persistence
affects: [phase-3, 04-programmatic-verifiers, 05-phase-runner, 06-pipeline-controller]

key-files:
  created:
    - src/state/schema.ts
    - src/state/state-manager.ts
    - src/state/index.ts

# Summary

State module: Zod schema for all forge-state.json fields (phases, services, mocks, credentials, spec compliance, UAT results, budget). StateManager with atomic write-rename for crash safety and Promise-based mutex for concurrent write protection. snake_case on disk, camelCase in TypeScript via bidirectional mapping.
