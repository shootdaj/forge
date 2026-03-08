---
phase: 02-foundation-config-state
plan: 01
subsystem: config
tags: [zod, config, validation, defaults]

# Dependency graph
requires:
  - phase: 01-sdk-proof-of-concept
    provides: SDK types for model configuration
provides:
  - loadConfig() with Zod validation and sensible defaults
  - ForgeConfig type with camelCase properties
  - Config schema covering all SPEC.md fields (model, budgets, retries, testing, parallelism)
affects: [phase-3, 04-programmatic-verifiers]

key-files:
  created:
    - src/config/schema.ts
    - src/config/loader.ts
    - src/config/index.ts
    - src/config/config.test.ts

# Summary

Config module: Zod schema for all forge.config.json fields with sensible defaults. loadConfig() validates, reports errors, and maps to camelCase TypeScript properties. Empty {} config is valid; missing file returns all defaults.
