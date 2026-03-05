---
phase: 06-pipeline-controller
verified: 2026-03-05T22:16:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 6: Pipeline Controller (Wave Model) Verification Report

**Phase Goal:** System can orchestrate multi-wave autonomous execution -- building with mocks, batching human needs into one checkpoint, swapping to real integrations, and converging on spec compliance
**Verified:** 2026-03-05T22:16:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Wave 1 executes all phases with mock external services following the interface/mock/real/factory pattern, tracking every mock in the mock registry | VERIFIED | `pipeline-controller.ts` executeWave1() calls MockManager.detectExternalServices() + buildMockInstructions() + registerMock() per phase. MockManager enforces 4-file pattern (interface/mock/real/factory) in buildMockInstructions(). 30 unit tests + 13 integration tests verify Wave 1 flow. |
| 2 | Human checkpoint batches ALL needs (services needing credentials, skipped items needing guidance, deferred ideas) into ONE interruption | VERIFIED | `human-checkpoint.ts` generateCheckpointReport() reads state.servicesNeeded + state.skippedItems + deferredIdeas into single CheckpointReport. formatCheckpointDisplay() formats all in one output. needsHumanCheckpoint() gates the pause. Pipeline returns `{ status: "checkpoint" }` with full report. 21 unit tests cover all checkpoint functions. |
| 3 | Wave 2 uses the mock registry to systematically swap every mock for real implementations and runs integration tests; skipped items are addressed with user guidance | VERIFIED | `pipeline-controller.ts` executeFromWave2() calls MockManager.getMockRegistry(), buildIntegrationPrompt(), MockManager.buildSwapPrompt(), and runStep("integrate-real-services"). Skipped items loop calls buildSkippedItemPrompt() with humanGuidance. Integration tests verify credentials flow and swap prompt content. |
| 4 | Spec compliance loop (Wave 3+) verifies every requirement, fixes gaps, and checks convergence (gaps must decrease each round; stops if not converging) | VERIFIED | `spec-compliance.ts` runSpecComplianceLoop() iterates up to maxComplianceRounds, calls verifyRequirement() for each ID with structured output, calls buildComplianceGapPrompt() + runStep() for fixes, checkConvergence() enforces strictly-decreasing gaps. 14 unit tests cover convergence logic, verification, and loop scenarios. |
| 5 | Dependency graph built from roadmap determines phase ordering via topological sort; after UAT passes, milestone audit and completion run | VERIFIED | `dependency-graph.ts` parseRoadmapPhases() + buildDependencyGraph() (3-color DFS cycle detection) + topologicalSort() (Kahn's algorithm). Pipeline controller uses getExecutionWaves() for phase ordering. UAT gate runs after compliance (lines 456-527). Milestone audit/complete runs after UAT (lines 529-608). 15 unit tests for dependency graph, pipeline tests cover UAT + milestone flow. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pipeline/types.ts` | All pipeline type definitions | VERIFIED | 253 lines. Exports PipelinePhase, PipelineContext, PipelineResult (discriminated union), WaveResult, ServiceDetection, MockEntry, SkippedItem, CheckpointReport, SpecComplianceResult. All types substantive with JSDoc. |
| `src/pipeline/dependency-graph.ts` | Dependency graph builder and topological sort | VERIFIED | 344 lines. Exports parseRoadmapPhases, buildDependencyGraph, topologicalSort, getExecutionWaves. Kahn's algorithm, 3-color DFS cycle detection. |
| `src/pipeline/mock-manager.ts` | Mock registry operations | VERIFIED | 368 lines. Exports MockManager class with registerMock, getMockRegistry, getMock, detectExternalServices (12 known services), buildMockInstructions, buildSwapPrompt, validateMockEntry. |
| `src/pipeline/human-checkpoint.ts` | Checkpoint report generation, pause/resume logic | VERIFIED | 260 lines. Exports generateCheckpointReport, formatCheckpointDisplay, writeCheckpointFile, loadResumeData, needsHumanCheckpoint. Env file parsing with quote handling, guidance parsing by ## headers. |
| `src/pipeline/spec-compliance.ts` | Spec compliance loop with convergence checking | VERIFIED | 292 lines. Exports checkConvergence, verifyRequirement (structured output via runStep), runSpecComplianceLoop. Convergence enforces strictly-decreasing gaps, state updated per round. |
| `src/pipeline/prompts.ts` | Prompt builders for pipeline-level agent steps | VERIFIED | 197 lines. Exports buildNewProjectPrompt, buildScaffoldPrompt, buildIntegrationPrompt, buildSkippedItemPrompt, buildComplianceGapPrompt. All pure functions. |
| `src/pipeline/pipeline-controller.ts` | Main runPipeline FSM | VERIFIED | 690 lines (min 150). Exports runPipeline. Full FSM: init -> Wave 1 -> checkpoint -> Wave 2 -> Wave 3 -> UAT -> milestone. Error handling per wave, safe state updates. |
| `src/pipeline/pipeline-controller.test.ts` | Unit tests for pipeline FSM | VERIFIED | 1054 lines (min 200). 30 tests across 7 describe blocks covering all FSM states. |
| `src/pipeline/index.ts` | Module public API | VERIFIED | 56 lines. Exports all functions, classes, and types from all 6 submodules. |
| `test/integration/pipeline.test.ts` | Integration tests | VERIFIED | 921 lines (min 200). 13 tests verifying component interactions. |
| `test/scenarios/pipeline.test.ts` | Scenario tests | VERIFIED | 881 lines (min 200). 9 tests verifying full workflows. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| dependency-graph.ts | types.ts | imports PipelinePhase type | WIRED | Line 14: `import type { PipelinePhase } from "./types.js"` |
| mock-manager.ts | state schema | reads/writes mockRegistry in ForgeState | WIRED | Lines 164-168 update mockRegistry, line 181 reads mockRegistry |
| spec-compliance.ts | step-runner | calls runStep for gap fixes | WIRED | Line 14: `import { runStep } from "../step-runner/step-runner.js"` |
| spec-compliance.ts | state | updates specCompliance in state | WIRED | Lines 191-202 and 221-234 update state.specCompliance |
| human-checkpoint.ts | types.ts | uses CheckpointReport type | WIRED | Line 16: `import type { CheckpointReport, ServiceDetection, SkippedItem } from "./types.js"` |
| pipeline-controller.ts | dependency-graph.ts | getExecutionWaves for phase ordering | WIRED | Line 14: `import { getExecutionWaves } from "./dependency-graph.js"` -- used at line 129 |
| pipeline-controller.ts | mock-manager.ts | MockManager for detecting services and building instructions | WIRED | Line 15: `import { MockManager } from "./mock-manager.js"` -- used at lines 216, 241-248, 356-374 |
| pipeline-controller.ts | human-checkpoint.ts | checkpoint report generation and needs check | WIRED | Lines 16-21: imports needsHumanCheckpoint, generateCheckpointReport, writeCheckpointFile, formatCheckpointDisplay -- all used in checkpoint section |
| pipeline-controller.ts | spec-compliance.ts | runSpecComplianceLoop for Wave 3+ | WIRED | Line 22: `import { runSpecComplianceLoop } from "./spec-compliance.js"` -- used at line 427 |
| pipeline-controller.ts | phase-runner | runPhaseFn for individual phase execution | WIRED | PipelineContext.runPhaseFn called at line 251 |
| test/integration/pipeline.test.ts | src/pipeline | imports pipeline module exports | WIRED | Lines 17-18: imports runPipeline, getExecutionWaves |
| test/scenarios/pipeline.test.ts | pipeline-controller.ts | imports runPipeline | WIRED | Line 30: `import { runPipeline } from "../../src/pipeline/pipeline-controller.js"` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-01 | 06-03, 06-04 | Wave 1 builds everything with mocks | SATISFIED | executeWave1() in pipeline-controller.ts; TestPipeline_Wave1_ExecutesAllPhases + scenario tests |
| PIPE-02 | 06-01, 06-04 | External services detected and built with mock pattern | SATISFIED | MockManager.detectExternalServices() + buildMockInstructions(); 17 mock-manager tests |
| PIPE-03 | 06-01, 06-04 | Mock registry tracks all mocked files | SATISFIED | MockManager.registerMock() + getMockRegistry(); state.mockRegistry persistence |
| PIPE-04 | 06-02, 06-04 | Human checkpoint batches ALL needs in ONE interruption | SATISFIED | generateCheckpointReport() + formatCheckpointDisplay() + writeCheckpointFile(); 21 checkpoint tests |
| PIPE-05 | 06-03, 06-04 | Wave 2 swaps mocks using registry | SATISFIED | executeFromWave2() calls buildIntegrationPrompt + buildSwapPrompt; integration tests verify |
| PIPE-06 | 06-03, 06-04 | Wave 2 addresses skipped items with guidance | SATISFIED | executeFromWave2() loops skippedItems with buildSkippedItemPrompt + humanGuidance |
| PIPE-07 | 06-02, 06-04 | Wave 3+ spec compliance loop | SATISFIED | runSpecComplianceLoop() + verifyRequirement() with structured output |
| PIPE-08 | 06-02, 06-04 | Convergence checking (gaps must decrease) | SATISFIED | checkConvergence() enforces strictly-decreasing; 7 convergence tests |
| PIPE-09 | 06-03, 06-04 | UAT runs as final gate after compliance | SATISFIED | UAT gate section (lines 456-527) with retry loop |
| PIPE-10 | 06-03, 06-04 | Milestone audit/complete after UAT | SATISFIED | Milestone section (lines 529-608): audit-milestone + fix-milestone-gaps + complete-milestone |
| PIPE-11 | 06-01, 06-04 | Dependency graph from roadmap, topological sort | SATISFIED | parseRoadmapPhases + buildDependencyGraph + topologicalSort; 15 unit tests |
| MOCK-01 | 06-01, 06-04 | 4-file pattern with FORGE:MOCK tag | SATISFIED | buildMockInstructions() generates instructions including tag requirement |
| MOCK-02 | 06-01, 06-04 | Mock registry in state tracks files | SATISFIED | MockManager.registerMock() persists to state.mockRegistry via StateManager.update() |
| MOCK-03 | 06-01, 06-04 | Wave 2 uses registry for systematic swap | SATISFIED | buildSwapPrompt() lists each mock with file paths and credentials |
| MOCK-04 | 06-01, 06-04 | Mock and real satisfy same TypeScript interface | SATISFIED | buildMockInstructions() explicitly states "MUST implement the SAME TypeScript interface" (MOCK-04) |

All 15 requirement IDs accounted for. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns found in source files |

Source files scanned for TODO/FIXME/HACK/PLACEHOLDER, empty implementations, console.log-only handlers, and stub return values. No blockers or warnings found.

### Human Verification Required

### 1. Real Roadmap Parsing

**Test:** Run `parseRoadmapPhases()` against the actual `.planning/ROADMAP.md` file and inspect the output.
**Expected:** All 8 phases extracted with correct dependency chains and requirement IDs matching the ROADMAP.md content.
**Why human:** Unit tests use sample roadmaps; the real ROADMAP.md has richer formatting that may have edge cases.

### 2. End-to-End Pipeline Run

**Test:** When Phase 7 (CLI) is implemented, run `forge run` on a small test project to verify the full wave model works with real Agent SDK calls.
**Expected:** Wave 1 builds with mocks, checkpoint pauses if services detected, resume works, Wave 3 converges.
**Why human:** All current tests mock runStep/runPhaseFn. Real SDK interaction not testable without burning tokens.

### Gaps Summary

No gaps found. All 5 observable truths verified with supporting evidence. All 15 requirement IDs satisfied with implementation evidence and test coverage. All artifacts exist, are substantive, and are properly wired. All 119 pipeline tests pass (97 unit + 13 integration + 9 scenario). Full test suite of 411 tests passes with zero regressions. TypeScript compiles without errors.

---

_Verified: 2026-03-05T22:16:00Z_
_Verifier: Claude (gsd-verifier)_
