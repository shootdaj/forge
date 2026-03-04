# Forge — Dark Factory Orchestrator

## What Is This?

Forge is an autonomous software development orchestrator. You give it a project spec, walk away, and it builds the entire thing — planned, coded, tested, documented, and shipped — without coming back to you unless it genuinely needs a human (account creation, API keys, payments).

It uses the **Claude Agent SDK** to run **AX commands** (which wrap GSD) as autonomous agents. Each phase of development runs in its own context window. The orchestrator stays alive across all phases, manages state, retries failures, and only exits when everything is done.

## Why Does This Exist?

Claude Code is interactive — it returns to you constantly. AX wraps GSD with testing/CI/Notion but still runs inside CC sessions that fill up and pause. Forge sits *outside* CC and drives it programmatically, so:

- No context window limits (each phase gets a fresh context)
- No permission prompts (bypass mode)
- No manual resume after pauses
- No human in the loop unless genuinely required

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Forge (Node.js process, stays alive)           │
│                                                 │
│  ┌─────────────┐                                │
│  │ State Manager│ ← reads/writes forge-state.json│
│  └──────┬──────┘                                │
│         │                                        │
│  ┌──────▼──────┐     ┌──────────────────┐       │
│  │ Phase Loop  │────▶│ Agent SDK query() │       │
│  │             │     │                   │       │
│  │ For each    │     │ - Fresh context   │       │
│  │ phase:      │     │ - bypassPerms     │       │
│  │  1. Check   │     │ - AX instructions │       │
│  │  2. Run     │     │ - Returns summary │       │
│  │  3. Verify  │     └──────────────────┘       │
│  │  4. Next    │                                 │
│  └─────────────┘                                │
│                                                 │
│  On failure: retry phase (up to N times)        │
│  On human-needed: pause + notify                │
│  On all done: run ax:finish, exit               │
└─────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime:** Node.js
- **Core dependency:** `@anthropic-ai/claude-agent-sdk`
- **AX:** Read from `~/.claude/commands/ax/` (globally installed)
- **State:** JSON file on disk (`forge-state.json` in project root)
- **Config:** `forge.config.json` in project root

## How the Agent SDK Works

The Agent SDK is Claude Code as a library. Same tools (Read, Write, Edit, Bash, Glob, Grep), same agent loop, same context management. It spawns a CC process under the hood.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Execute phase 3 of this project...",
  options: {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Task"],
    permissionMode: "bypassPermissions",
    maxTurns: 200,
    maxBudgetUsd: 15.00,
    model: "claude-opus-4-6",
    // Subagents for parallelism within a phase
    agents: {
      "implementer": {
        description: "Implements code changes",
        prompt: "...",
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      },
      "tester": {
        description: "Writes and runs tests",
        prompt: "...",
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      }
    }
  }
})) {
  // Process messages, extract results
}
```

### Key SDK Features We Use

| Feature | What It Does | How We Use It |
|---|---|---|
| `query()` | Async generator that runs a full agent session | One call per phase |
| `permissionMode: "bypassPermissions"` | No permission prompts | Fully autonomous |
| `maxBudgetUsd` | Dollar cap per session | Cost control per phase |
| `maxTurns` | Turn limit per session | Prevent runaway agents |
| `agents` | Define subagents | Parallel work within a phase |
| `mcpServers` | MCP connections | Notion integration |
| `resume` / `sessionId` | Session management | Resume interrupted phases |
| `hooks` | Lifecycle callbacks | Monitor progress, log events |

### Agent SDK vs Other Options

| Approach | Why Not |
|---|---|
| Raw Claude API | Would require rebuilding all CC tools (Read, Edit, Bash, etc.) from scratch |
| CC Headless (`claude -p`) | Works but limited: no programmatic control over messages, harder error handling |
| CC Interactive | Returns to user, context fills up, needs manual resume |
| **Agent SDK** | **CC as a library. All tools built in. Programmatic control. Fresh context per call.** |

## Core Components

### 1. CLI Entry Point (`forge`)

```bash
# Initialize a new project
forge init

# Run all phases autonomously
forge run

# Run a single phase
forge phase 3

# Check status
forge status

# Resume after interruption
forge resume
```

### 2. State Manager

Persists orchestrator state to `forge-state.json`:

```json
{
  "project_dir": "/path/to/project",
  "started_at": "2026-03-04T...",
  "model": "claude-opus-4-6",
  "phases": {
    "1": {
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "attempts": 1,
      "test_results": { "unit": 12, "integration": 5, "scenario": 3 },
      "budget_used": 4.23
    },
    "2": {
      "status": "in_progress",
      "started_at": "...",
      "attempts": 2,
      "last_error": "integration tests failed: 2 failures"
    }
  },
  "total_budget_used": 4.23,
  "max_budget": 100.00
}
```

### 3. Phase Runner

For each phase:

1. **Pre-check:** Read ROADMAP.md, detect if phase needs external setup
2. **Prompt construction:** Read AX phase command (`~/.claude/commands/ax/phase.md`), inject phase number, project config, and any context from previous phases
3. **Execute:** `query()` with the constructed prompt
4. **Parse result:** Extract pass/fail, test counts, issues from the agent's output
5. **Post-check:** Update state, decide next action

### 4. Retry Logic

```
Phase fails
  → Attempt 1: re-run with error context injected
  → Attempt 2: re-run with simplified scope (skip Notion, focus on code+tests)
  → Attempt 3: stop, log failure, notify user
```

Max retries configurable. Default: 3.

### 5. Human Gate Handler

Some things genuinely need a human:
- Creating cloud accounts (AWS, Stripe, etc.)
- Entering API keys
- Making payments
- OAuth app registration

When detected:
1. Pause the orchestrator
2. Log what's needed to stdout and `forge-state.json`
3. Wait for user to run `forge resume` after completing the action
4. Optional: send notification (webhook, email, Slack via MCP)

### 6. Cost Controller

- Per-phase budget: `maxBudgetUsd` on each `query()` call
- Total project budget: tracked in state, abort if exceeded
- Log cost per phase for visibility

## Config File (`forge.config.json`)

Created by `forge init` or manually:

```json
{
  "model": "claude-opus-4-6",
  "max_budget_total": 100.00,
  "max_budget_per_phase": 15.00,
  "max_retries": 3,
  "max_turns_per_phase": 200,
  "ax_commands_path": "~/.claude/commands/ax",
  "notion": {
    "enabled": true,
    "parent_page_id": "..."
  },
  "mcp_servers": {
    "notion": {
      "command": "npx",
      "args": ["@anthropic-ai/notion-mcp"]
    }
  },
  "notifications": {
    "on_human_needed": "stdout",
    "on_phase_complete": "stdout",
    "on_failure": "stdout"
  }
}
```

## Workflow

### `forge init`

1. Prompts for project description (or reads from a spec file)
2. Runs AX init via `query()`: GSD new-project → stack detection → CI → testing → Notion
3. Writes `forge.config.json` and `forge-state.json`
4. Displays summary

### `forge run`

1. Reads state — find first incomplete phase
2. For each remaining phase:
   a. Run phase via `query()` with AX phase instructions
   b. Parse results
   c. On success: update state, continue
   d. On failure: retry up to max, then stop
   e. On human-needed: pause, wait for `forge resume`
3. After all phases: run AX finish via `query()`
4. Exit with summary

### `forge phase N`

Run a single phase. Same as one iteration of `forge run`.

### `forge status`

Read `forge-state.json`, display progress table, test results, budget used.

### `forge resume`

Continue from where `forge run` paused (human gate or failure).

## Agent Teams (Future Enhancement)

For large phases, Forge could use Agent Teams to parallelize work within a phase:

```typescript
// Enable agent teams in the query options
options: {
  agents: {
    "backend": { description: "Implements backend code", ... },
    "frontend": { description: "Implements frontend code", ... },
    "tests": { description: "Writes all tests", ... },
  }
}
```

This is a v2 feature. v1 runs phases sequentially with subagents for focused tasks.

## Competitive Context

### What Exists Today

| Tool | Autonomous? | Multi-Phase? | Success Rate | Cost |
|---|---|---|---|---|
| Devin | Yes | Weak (single session) | 3/20 independent test | $20/mo + ACU |
| Cursor Cloud | Yes (52hr demo) | Moderate | Good for parallel work | $60/mo+ |
| OpenAI Codex | Yes (7-24hr) | Weak (isolated tasks) | 56.8% SWE-Bench | $20-200/mo |
| Claude Code | Yes (headless) | Strong (sub-agents) | Best model quality | API costs |
| **Forge** | **Yes (unlimited)** | **Strong (phase-based)** | **Same model + structured workflow** | **API costs** |

### StrongDM's Dark Factory (Reference Implementation)

The only known production Level 4 autonomous coding setup:
- 3 engineers, no human writes or reviews code
- **Attractor**: non-interactive agent that receives markdown specs
- **Digital Twin Universe**: fake versions of Okta, Jira, Slack, Google for testing without rate limits or flaky networks
- **Holdout scenario testing**: separate AI evaluates if code meets spec (like train/test splits in ML — the evaluator never sees the implementation, only the spec and behavior)
- **Cost**: ~$1,000/day/engineer in tokens
- Key insight: writing code is easy, **verifying it's correct** is the hard part

### What Makes Forge Different

Forge doesn't try to be a general-purpose autonomous agent. It's an orchestrator for a specific workflow (AX → GSD) that:
1. Uses proven tools (CC's full toolset via Agent SDK)
2. Has structured phases (not open-ended "build me an app")
3. Enforces testing at every phase (testing pyramid via AX)
4. Manages cost explicitly (per-phase budgets)
5. Handles context limits by design (fresh context per phase)

## Success Criteria

### v1 (MVP)
- [ ] `forge init` runs AX init autonomously
- [ ] `forge run` executes all phases without returning to user
- [ ] Each phase gets a fresh context via separate `query()` call
- [ ] Failed phases retry up to 3 times with error context
- [ ] Human gates pause and resume cleanly
- [ ] State persists across interruptions
- [ ] Cost tracked per phase and total
- [ ] Works with any stack AX supports

### v2
- [ ] Agent Teams for intra-phase parallelism
- [ ] Webhook/Slack notifications for human gates
- [ ] Dashboard showing phase progress, costs, test results
- [ ] Configurable retry strategies
- [ ] Multiple concurrent projects

## File Structure

```
forge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point
│   ├── orchestrator.ts       # Main phase loop
│   ├── state.ts              # State manager (read/write forge-state.json)
│   ├── phase-runner.ts       # Runs a single phase via query()
│   ├── prompt-builder.ts     # Constructs prompts from AX commands
│   ├── result-parser.ts      # Extracts results from agent output
│   ├── human-gate.ts         # Handles human-needed pauses
│   ├── cost-controller.ts    # Budget tracking and enforcement
│   └── config.ts             # Config file management
├── forge.config.json         # Project config (template)
└── README.md
```
