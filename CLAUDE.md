# Forge — Project Instructions

## What This Is

Forge is an autonomous software development orchestrator built on the Claude Agent SDK. Read `SPEC.md` for the full specification — it describes the architecture, wave model, components, and behavior in detail.

## Critical: Code Blocks in SPEC.md Are Pseudocode

The TypeScript code blocks in SPEC.md are **illustrative pseudocode showing intent**, NOT copy-paste implementations. They show data flow and logic but:

- Have approximate function signatures and types
- Reference helper functions that aren't defined
- Use simplified error handling
- May not match the actual Agent SDK API surface

**Your job is to implement the BEHAVIOR described in the spec, not to transcribe the code blocks.** Read the prose descriptions as the source of truth. Use the code blocks to understand structure and data flow, then implement properly with real error handling, correct SDK usage, and idiomatic TypeScript.

## Critical: Agent SDK Breaking Changes

The spec was written assuming older SDK behavior. The current `@anthropic-ai/claude-agent-sdk` has these breaking changes you MUST account for:

### 1. No System Prompt by Default
The SDK no longer uses Claude Code's system prompt. To get GSD slash commands and Claude Code behavior, you MUST set:
```typescript
systemPrompt: { type: "preset", preset: "claude_code" }
```

### 2. No Settings Loaded by Default
The SDK no longer reads CLAUDE.md, settings.json, or slash commands from the filesystem. To get GSD skills available, you MUST set:
```typescript
settingSources: ["user", "project", "local"]
```

### 3. Permission Mode
Verify the exact permission mode values against current SDK docs. The spec uses `"bypassPermissions"` — confirm this is still the correct value. Alternative may be `"acceptEdits"` or similar.

### 4. Correct Package
```bash
npm install @anthropic-ai/claude-agent-sdk
```
Import: `import { query } from "@anthropic-ai/claude-agent-sdk";`

## Build Strategy

**Before writing any application code**, do this first:
1. Research the Agent SDK's actual TypeScript API by reading its docs and source
2. Build a minimal proof-of-concept: a single `query()` call that runs a simple GSD command and returns structured output
3. Verify: system prompt preset works, settings sources load GSD skills, permission mode allows autonomous operation
4. Only THEN start building the full pipeline

**Build order priority:**
1. CLI entry point + config/state management (foundation)
2. Step runner with query() integration (core primitive — everything depends on this)
3. Programmatic verifiers (the second most critical piece)
4. Phase runner (uses step runner + verifiers)
5. Pipeline controller with wave model (orchestrates phase runner)
6. Requirements gatherer (interactive mode)
7. Everything else (Notion, UAT, gap closure, etc.)

## Tech Stack

- TypeScript, Node.js
- `@anthropic-ai/claude-agent-sdk` — the core dependency
- `commander` or similar for CLI
- No frontend, no database — this is a CLI tool

## Testing

Write tests at all tiers:
- **Unit tests** for pure logic: state serialization, config loading, roadmap parsing, dependency graph, convergence checking
- **Integration tests** for SDK interaction: verify query() calls work, verify message parsing, verify structured output extraction
- **Scenario tests** for end-to-end flows: run a phase on a small test project, verify state updates correctly

Mock the Agent SDK's `query()` for unit/integration tests so they don't burn tokens.

# Testing Requirements (AX)

Every feature implementation MUST include tests at all three tiers:

## Test Tiers
1. **Unit tests** — Test individual functions/methods in isolation. Mock external dependencies.
2. **Integration tests** — Test component interactions with mocked Agent SDK query() calls.
3. **Scenario tests** — Test full user workflows end-to-end.

## Test Naming
Use semantic names: `Test<Component>_<Behavior>[_<Condition>]`
- Good: `TestStepRunner_BudgetExceeded`, `TestFullPipelineFlow`
- Bad: `TestShouldWork`, `Test1`, `TestGivenUserWhenLoginThenSuccess`

## Reference
- See `TEST_GUIDE.md` for requirement-to-test mapping
- See `.claude/ax/references/testing-pyramid.md` for full methodology
- Every requirement in ROADMAP.md must map to at least one scenario test
