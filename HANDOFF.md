# Forge Build — Handoff Instructions

## For the Human

Open a new Claude Code session in the `forge` repo directory and run:

```
/ax:init
```

When AX asks about the project, paste the prompt below. AX will handle everything: GSD project setup, research, roadmap, CI scaffolding, testing infrastructure, Notion docs, and then you can run `/ax:run` to build autonomously.

---

## Prompt to Paste During /ax:init

```
Build Forge — an autonomous software development orchestrator.

The complete specification is in SPEC.md in this repo. Read it thoroughly — it is the source of truth for everything: architecture, wave model, components, behavior, state management, config format, verification approach, and success criteria.

IMPORTANT CONTEXT:

1. SPEC.md code blocks are PSEUDOCODE. They show intent and data flow but are NOT production code. Do NOT copy them verbatim. Implement the BEHAVIOR described in the prose sections. The prose is authoritative over code blocks.

2. The core dependency is @anthropic-ai/claude-agent-sdk (the Claude Agent SDK). Before writing any application code, research the SDK's actual TypeScript API — it has breaking changes from what the spec's pseudocode assumes:
   - No system prompt by default: must set systemPrompt: { type: "preset", preset: "claude_code" } to get Claude Code behavior and GSD slash commands
   - No settings loaded by default: must set settingSources: ["user", "project", "local"] to load CLAUDE.md and GSD skills
   - Verify the exact permissionMode values against current SDK docs
   - Package: @anthropic-ai/claude-agent-sdk, import { query } from "@anthropic-ai/claude-agent-sdk"

3. Build order matters. Start with:
   a. CLI entry point (commander.js) + config/state management
   b. Step runner — the core primitive that wraps query() with budget enforcement, error handling, and verification. Get a single query() call working with GSD first.
   c. Programmatic verifiers (files, tests, typecheck, lint, docker, test-coverage, observability, deployment)
   d. Phase runner (uses step runner + verifiers for the full phase cycle)
   e. Pipeline controller with wave model (orchestrates phases)
   f. Requirements gatherer (interactive mode for forge init)
   g. Supporting modules: Notion, UAT, gap closure, mock manager, traceability

4. This is a Node.js TypeScript CLI tool. No frontend, no database. The output is a CLI binary called "forge" with commands: init, run, phase, status, resume.

5. Testing: Write real tests. Unit tests for pure logic (state serialization, config, dependency graphs, convergence). Integration tests for SDK interaction (mock query() to avoid burning tokens). The testing pyramid in SPEC.md applies to Forge itself, not just projects Forge builds.

6. Read CLAUDE.md for additional project-specific instructions including SDK breaking changes and build strategy.
```

---

## After /ax:init Completes

Review the roadmap it creates. Then run:

```
/ax:run
```

This will autonomously build all phases. It should only pause if it genuinely needs something from you (like a Notion parent page ID for documentation).

## If Something Goes Wrong

- If a phase fails: AX will attempt gap closure automatically. If it still fails, it'll ask you.
- If context runs out: AX creates a handoff. Run `/ax:run` again to resume.
- If the Agent SDK API is different than expected: The agent should research it via web search during planning. If it doesn't, tell it to look up the actual `@anthropic-ai/claude-agent-sdk` TypeScript API docs before proceeding.

## Success Criteria

The spec has a comprehensive list (v1 section). The most critical items to verify first:

1. `forge init` gathers requirements interactively and produces REQUIREMENTS.md
2. `forge run` executes the wave model (build → checkpoint → integrate → verify → UAT)
3. Each step uses a fresh `query()` call with the Agent SDK
4. Verification is programmatic (code checks, not agent self-report)
5. State persists across interruptions via forge-state.json
6. `forge resume` picks up after human checkpoint with credentials/guidance
