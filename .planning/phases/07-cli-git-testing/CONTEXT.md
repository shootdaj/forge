# Phase 7 Context: CLI + Git + Testing Infrastructure

## Phase Goal

Users can interact with Forge through CLI commands, code is managed with proper git workflow, and test traceability is maintained.

## Requirements

CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, COST-05, GIT-01, GIT-02, GIT-03, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05

## Decisions

### 1. CLI Framework

Use `commander` for the CLI entry point. It's the standard Node.js CLI library with excellent TypeScript support. The CLI is a thin layer that delegates to existing modules:
- `forge init` -> calls requirements gathering (Phase 8 builds the actual gatherer; Phase 7 wires the CLI command)
- `forge run` -> calls `runPipeline()` from pipeline controller (Phase 6)
- `forge phase N` -> calls `runPhase()` from phase runner (Phase 5) with pipeline-level setup
- `forge status` -> reads forge-state.json and displays formatted output
- `forge resume --env FILE [--guidance FILE]` -> loads credentials/guidance and calls `runPipeline()` with resumed state

### 2. CLI Entry Point Architecture

`src/cli/index.ts` is the main entry point. Uses commander to define commands. Each command handler is a thin function that:
1. Loads config via `loadConfig()`
2. Creates/loads state via `StateManager`
3. Creates CostController and StepRunnerContext
4. Delegates to the appropriate module
5. Handles errors and displays output

The CLI binary is registered in package.json `bin` field so `npx forge` works.

### 3. Git Workflow

Phase-level branching with atomic commits:
- Each phase executes on a `phase-N` branch created from main
- Commits include requirement IDs in the format `feat(R1): description`
- After verification passes, the branch is merged to main
- Git operations (branch, commit, merge) are implemented as utility functions in `src/cli/git.ts`
- GitHub Flow: main is protected, phase branches for work, merge after verification

### 4. Status Display

`forge status` reads forge-state.json and displays:
- Current wave and position (e.g., "Wave 1, Phase 3/8")
- Phase progress table (status, budget used per phase)
- Services needed (with mock status)
- Skipped items (with attempt history)
- Spec compliance (X/Y requirements verified, gap history)
- Budget breakdown (per phase, per wave, total)
- Uses plain text formatting for terminal output

### 5. Testing Infrastructure

TEST_GUIDE.md management:
- `src/cli/traceability.ts` manages the TEST_GUIDE.md file
- Creates it during scaffolding with requirement-to-test mapping headers
- Updates it after every phase with new test mappings
- Verifies every requirement maps to at least one test at each tier
- Test pyramid enforced per phase: new code must have tests, test count must increase

Testing methodology injection:
- During init/scaffolding, append testing methodology to the target project's CLAUDE.md
- Includes test naming conventions, tier definitions, requirement references

### 6. Scope Boundaries

**In scope for Phase 7:**
- CLI commands: init (stub), run, phase, status, resume
- Git utilities: branch, commit with req IDs, merge
- Traceability: TEST_GUIDE.md CRUD, test pyramid enforcement
- Testing methodology injection into project CLAUDE.md
- Budget display (COST-05)

**Out of scope (Phase 8):**
- Full requirements gathering logic for `forge init` (Phase 7 wires the command; Phase 8 builds the interactive questionnaire)
- UAT execution logic
- Notion documentation creation during init

### 7. Testing Strategy

- Unit tests: CLI argument parsing, git utility functions, status formatter, traceability operations, testing methodology generation
- Integration tests: CLI command execution with mocked modules, git operations on temp repos
- Scenario tests: full CLI workflows (init -> run, status display, resume from checkpoint)

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology
