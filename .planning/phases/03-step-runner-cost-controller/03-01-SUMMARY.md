---
phase: phase-3
plan: 01
subsystem: step-runner
tags: [budget, cost-tracking, retry, cascade, executeQuery]

# Dependency graph
requires:
  - phase: 01-sdk-proof-of-concept
    provides: executeQuery() wrapper
  - phase: 02-foundation-config-state
    provides: Config and StateManager
provides:
  - runStep() with budget enforcement and verification callbacks
  - runStepWithCascade() with retry logic (3x retry, skip, stop)
  - Cost controller with per-step and per-phase budget tracking
  - BudgetExceededError for hard stops
affects: [05-phase-runner, 06-pipeline-controller]

key-files:
  created:
    - src/step-runner/types.ts
    - src/step-runner/step-runner.ts
    - src/step-runner/cost-controller.ts
    - src/step-runner/cascade.ts
    - src/step-runner/index.ts
    - src/step-runner/step-runner.test.ts
    - src/step-runner/cascade.test.ts
    - src/step-runner/cost-controller.test.ts

# Summary

Step runner: runStep() wraps executeQuery() with per-step budget (maxBudgetUsd), project budget hard-stop, verification callback, and cost tracking. runStepWithCascade() retries failed steps up to 3x with error context in each retry prompt, then skips and flags, then stops. SDK errors (network, auth) bypass cascade entirely. Cost tracked per step and accumulated per phase via cost controller.
