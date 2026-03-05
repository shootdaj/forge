# Phase 6 Report: Pipeline Controller (Wave Model)

## Summary

| Property | Value |
|---|---|
| **Phase** | 6 |
| **Title** | Pipeline Controller (Wave Model) |
| **Status** | Completed |
| **Branch** | `phase-1-setup` |
| **Date** | 2026-03-05 |

## Requirements Delivered

| Requirement | Status | Evidence |
|---|---|---|
| PIPE-01: Wave 1 builds everything with mocks | Done | `runPipeline()` Wave 1 executes all phases with mock instructions via `MockManager.buildMockInstructions()` |
| PIPE-02: External services detected, mock pattern | Done | `MockManager.detectExternalServices()` scans phase descriptions for service keywords |
| PIPE-03: Mock registry tracks all mocked files | Done | `MockManager.registerMock()` writes to `state.mockRegistry` via StateManager |
| PIPE-04: Human checkpoint batches ALL needs | Done | `generateCheckpointReport()` batches services + skipped + deferred; `writeCheckpointFile()` writes JSON |
| PIPE-05: Wave 2 swaps mocks using registry | Done | `runPipeline()` Wave 2 calls `MockManager.buildSwapPrompt()` with registry and credentials |
| PIPE-06: Wave 2 addresses skipped items | Done | `runPipeline()` Wave 2 iterates skipped items with `buildSkippedItemPrompt()` and user guidance |
| PIPE-07: Wave 3+ spec compliance loop | Done | `runSpecComplianceLoop()` verifies each requirement, fixes gaps iteratively |
| PIPE-08: Convergence checking | Done | `checkConvergence()` stops when gaps >= previous round |
| PIPE-09: UAT as final gate | Done | `runPipeline()` runs UAT step after spec compliance converges |
| PIPE-10: Milestone audit + complete | Done | `runPipeline()` calls audit-milestone and complete-milestone after UAT passes |
| PIPE-11: Dependency graph (topological sort) | Done | `buildDependencyGraph()` + `topologicalSort()` using Kahn's algorithm |
| MOCK-01: 4-file pattern with FORGE:MOCK tag | Done | `MockManager.buildMockInstructions()` generates 4-file pattern instructions |
| MOCK-02: Mock registry in state | Done | `MockManager.registerMock()` / `getMockRegistry()` via StateManager |
| MOCK-03: Wave 2 uses registry to swap | Done | `MockManager.buildSwapPrompt()` lists each mock file and credentials for replacement |
| MOCK-04: Mock and real satisfy same TS interface | Done | Mock instructions specify same-interface requirement |

## Test Results

| Tier | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit | 318 | 318 | 0 | 0 |
| Integration | 47 | 47 | 0 | 0 |
| Scenario | 46 | 46 | 0 | 0 |

## New Tests Added

### Unit Tests (97 new)
- `dependency-graph.test.ts` -- 15 tests: roadmap parsing, linear chain, parallel phases, complex graph, circular detection
- `mock-manager.test.ts` -- 17 tests: register/retrieve, detect services, mock instructions, swap prompts, validation
- `human-checkpoint.test.ts` -- 21 tests: report generation, display formatting, file writing, resume data parsing, needs detection
- `spec-compliance.test.ts` -- 14 tests: convergence checking, requirement verification, compliance loop (converge, stuck, max rounds)
- `prompts.test.ts` -- 9 tests: all 5 prompt builders with edge cases (was 5 minimum, expanded)
- `pipeline-controller.test.ts` -- 30 tests: FSM states, wave transitions, checkpoint, mock swap, compliance, UAT, milestone, errors

### Integration Tests (13 new)
- Pipeline dependency graph determines phase order, parallel phases in same wave
- Mock registry populates during Wave 1, swap prompt uses registry
- Checkpoint batches services and skipped, resume loads credentials
- Compliance updates state per round, stops on non-convergence
- Wave transitions update status, budget tracks across waves

### Scenario Tests (9 new)
- Full run without external services, with external services, with skipped items
- Compliance not converging returns stuck, phase failure continues others
- Resume from checkpoint, resume from Wave 3
- Budget exhaustion returns failed, requirement coverage meta-test

## Architecture Changes

- New module: `src/pipeline/` with 8 source files
  - `types.ts` -- PipelineContext, PipelineResult, PipelinePhase, WaveResult, ServiceDetection, MockEntry, SkippedItem, CheckpointReport, SpecComplianceResult
  - `dependency-graph.ts` -- parseRoadmapPhases, buildDependencyGraph, topologicalSort, getExecutionWaves
  - `mock-manager.ts` -- MockManager class (register, detect, build instructions, build swap, validate)
  - `human-checkpoint.ts` -- generateCheckpointReport, formatCheckpointDisplay, writeCheckpointFile, loadResumeData, needsHumanCheckpoint
  - `spec-compliance.ts` -- checkConvergence, verifyRequirement, runSpecComplianceLoop
  - `prompts.ts` -- buildNewProjectPrompt, buildScaffoldPrompt, buildIntegrationPrompt, buildSkippedItemPrompt, buildComplianceGapPrompt
  - `pipeline-controller.ts` -- runPipeline (main FSM)
  - `index.ts` -- public API
- Dependency chain: pipeline -> phase-runner -> step-runner -> sdk, pipeline -> verifiers, pipeline -> config, pipeline -> state

## Known Issues

None.

## Gap Closures

No gap closure needed.

---
_Generated by `/ax:phase 6`_
