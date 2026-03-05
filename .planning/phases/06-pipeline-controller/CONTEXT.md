# Phase 6 Context: Pipeline Controller (Wave Model)

## Phase Goal

System can orchestrate multi-wave autonomous execution — building with mocks, batching human needs into one checkpoint, swapping to real integrations, and converging on spec compliance.

## Requirements

PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06, PIPE-07, PIPE-08, PIPE-09, PIPE-10, PIPE-11, MOCK-01, MOCK-02, MOCK-03, MOCK-04

## Decisions

### 1. Wave Model FSM

The pipeline controller is a finite state machine with states: `initializing` → `wave_1` → `human_checkpoint` → `wave_2` → `wave_3` → `uat` → `completed` (or `failed` at any point). This maps directly to the `OrchestratorStatus` type already defined in `src/state/schema.ts`. State transitions are driven by code, not prompts.

### 2. Dependency Graph & Topological Sort

Phase ordering uses a dependency graph built from the roadmap's "Depends on" fields. Topological sort produces execution waves (groups of independent phases that can run concurrently). For v1, phases execute sequentially within each wave — true parallelism (`maxConcurrentPhases > 1`) is a v2 concern but the graph structure supports it.

### 3. Mock Management Pattern

External service detection happens per-phase during Wave 1. Every mocked service follows the 4-file pattern: interface + mock + real + factory. All mock files get a `// FORGE:MOCK` tag. The mock registry in state (`mockRegistry`) tracks file paths precisely for systematic swap in Wave 2. Mock manager is a code module, not an agent step.

### 4. Human Checkpoint Strategy

The human checkpoint is a blocking pause that:
- Batches ALL needs: services needing credentials, skipped items needing guidance, deferred ideas
- Writes a checkpoint report to `forge-checkpoint.json` and prints a summary to stdout
- Resumes via `forge resume --env .env.production [--guidance guidance.md]`
- Credentials are loaded from the env file into `state.credentials`
- Guidance is parsed from the guidance file into `state.humanGuidance`

### 5. Spec Compliance Loop

Wave 3+ iterates over all requirements, verifying each programmatically. Uses convergence checking: gaps must decrease each round. Stops if not converging (gaps >= previous round). Max rounds from config (`maxComplianceRounds`). This is a code loop calling `runStep()` for each gap fix, not a single agent session.

### 6. Integration with Existing Modules

Pipeline controller composes:
- `runPhase()` from phase-runner (Phase 5) for individual phase execution
- `runStep()` / `runStepWithCascade()` from step-runner (Phase 3) for individual steps
- `runVerifiers()` from verifiers (Phase 4) for programmatic checks
- `StateManager` from state (Phase 2) for persistence
- `loadConfig()` from config (Phase 2) for configuration
- `CostController` from step-runner (Phase 3) for budget tracking

### 7. Scope Boundaries

**In scope for Phase 6:**
- Pipeline controller FSM (wave model state machine)
- Dependency graph builder + topological sort
- Mock manager (detect services, register mocks, swap mocks)
- Human checkpoint (pause, report, resume)
- Spec compliance loop (verify requirements, fix gaps, convergence)
- Prompt builders for pipeline-level steps (scaffold, integrate, gap closure)
- Pipeline types and interfaces

**Out of scope (later phases):**
- CLI commands (`forge run`, `forge resume`) — Phase 7
- UAT execution — Phase 8
- Requirements gathering — Phase 8
- Notion documentation — Phase 8
- Actual GSD new-project / scaffold calls (pipeline builds prompts, CLI invokes them)

### 8. Testing Strategy

- Unit tests: dependency graph, topological sort, mock registry operations, convergence checking, checkpoint report generation, prompt builders
- Integration tests: wave transitions with mocked phase runner, mock swap pipeline, spec compliance with mocked verifiers
- Scenario tests: full pipeline run (Wave 1 → checkpoint → Wave 2 → compliance → completion) with all dependencies mocked

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology
