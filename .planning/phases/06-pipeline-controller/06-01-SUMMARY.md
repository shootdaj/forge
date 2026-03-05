---
phase: 06-pipeline-controller
plan: 01
subsystem: pipeline
tags: [dependency-graph, topological-sort, mock-management, wave-model]

# Dependency graph
requires:
  - phase: 05-phase-runner
    provides: PhaseRunnerContext, PhaseResult, RunPhaseOptions types
  - phase: 03-step-runner
    provides: StepRunnerContext, CostController types
  - phase: 02-foundation
    provides: StateManager, ForgeState, ForgeConfig types
provides:
  - Pipeline type definitions (PipelineContext, PipelineResult, WaveResult, etc.)
  - Dependency graph builder with topological sort for phase execution ordering
  - Mock manager for service detection, registration, prompt building, and validation
  - Pipeline module public API (index.ts)
affects: [06-02, 06-03, 06-04, 07-cli]

# Tech tracking
tech-stack:
  added: []
  patterns: [topological-sort-waves, 4-file-mock-pattern, keyword-service-detection]

key-files:
  created:
    - src/pipeline/types.ts
    - src/pipeline/dependency-graph.ts
    - src/pipeline/dependency-graph.test.ts
    - src/pipeline/mock-manager.ts
    - src/pipeline/mock-manager.test.ts
    - src/pipeline/index.ts
  modified: []

key-decisions:
  - "Kahn's algorithm for topological sort produces wave groupings naturally (phases with no unresolved deps form each wave)"
  - "12 known service patterns with keyword matching for external service detection (extensible array)"
  - "MockManager uses StateManager.update() for registry persistence -- same crash-safe pattern as all state mutations"
  - "buildMockInstructions generates prompt text (string), not structured data -- consumed as prompt appendix by phase runner"

patterns-established:
  - "Topological sort wave pattern: parse -> graph -> sort produces number[][] of independent execution groups"
  - "Mock 4-file pattern: interface/mock/real/factory with FORGE:MOCK tag and same-interface contract (MOCK-04)"
  - "In-memory MockStateManager pattern for testing MockManager without disk I/O"

requirements-completed: [PIPE-11, PIPE-02, PIPE-03, MOCK-01, MOCK-02, MOCK-03, MOCK-04]

# Metrics
duration: 5min
completed: 2026-03-05
---

# Phase 6 Plan 01: Pipeline Types, Dependency Graph, and Mock Manager Summary

**Dependency graph with Kahn's topological sort for wave-based execution ordering and mock manager with 4-file pattern for service detection, registration, and Wave 1/2 prompt generation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-05T14:35:41Z
- **Completed:** 2026-03-05T14:40:14Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Pipeline type system with 9 types including discriminated unions for PipelineResult and comprehensive MockEntry/CheckpointReport/SpecComplianceResult
- Dependency graph: roadmap parser, adjacency list builder with cycle detection (3-color DFS), Kahn's topological sort producing execution waves
- Mock manager: registry CRUD via StateManager, keyword-based service detection (12 services), 4-file mock instructions builder, Wave 2 swap prompt builder, entry validation
- 32 unit tests across 2 test files (15 dependency graph + 17 mock manager)

## Task Commits

Each task was committed atomically:

1. **Task 1: Pipeline types and dependency graph** - `8abe83f` (feat)
2. **Task 2: Mock manager with registry operations** - `f2e086e` (feat)

## Files Created/Modified
- `src/pipeline/types.ts` - All pipeline type definitions (PipelineContext, PipelineResult, WaveResult, ServiceDetection, MockEntry, CheckpointReport, SpecComplianceResult, SkippedItem, PipelinePhase)
- `src/pipeline/dependency-graph.ts` - parseRoadmapPhases, buildDependencyGraph, topologicalSort, getExecutionWaves
- `src/pipeline/dependency-graph.test.ts` - 15 unit tests for parsing, graph building, toposort, and edge cases
- `src/pipeline/mock-manager.ts` - MockManager class with register, detect, build instructions, build swap prompt, validate
- `src/pipeline/mock-manager.test.ts` - 17 unit tests for registry ops, detection, prompt building, validation
- `src/pipeline/index.ts` - Pipeline module public API exporting all types and functions

## Decisions Made
- Kahn's algorithm chosen for topological sort because it naturally produces wave groupings (BFS layers = execution waves)
- 12 known service patterns with keyword-based matching for external service detection; easily extensible via KNOWN_SERVICES array
- Mock registry operations use StateManager.update() for crash-safe persistence consistency
- Prompt builders return plain strings (not structured data) since they are consumed as prompt appendices
- Cycle detection uses 3-color DFS (WHITE/GRAY/BLACK) for clear cycle path reporting in error messages

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline types ready for use by Plans 02 (checkpoint + compliance), 03 (FSM), and 04 (integration tests)
- Dependency graph ready to determine phase execution order in the pipeline controller
- Mock manager ready to detect services and generate prompts during wave execution
- All exports available via `src/pipeline/index.ts`

## Self-Check: PASSED

- All 6 created files verified present on disk
- Both task commits (8abe83f, f2e086e) verified in git history
- 32/32 tests pass across 2 test files
- TypeScript compiles without errors

---
*Phase: 06-pipeline-controller*
*Completed: 2026-03-05*
