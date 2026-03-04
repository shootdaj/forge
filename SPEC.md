# Forge — Dark Factory Orchestrator

## What Is This?

Forge is an autonomous software development orchestrator. You give it a project spec, it gathers deep requirements interactively, then you walk away — it builds the entire production system (code, tests, CI/CD, observability, QA, security, deployment, documentation) without coming back unless it genuinely needs a human (account creation, API keys, payments).

It uses the **Claude Agent SDK** (Claude Code as a library) to call **GSD skills directly** as focused agents. Each step runs in its own context window. Forge controls the pipeline with deterministic code, verifies results programmatically, retries failures, and only exits when requirements are met.

## Why Does This Exist?

Claude Code is interactive — it returns to you constantly. Even with automation layers like AX, the underlying model still decides when to pause, what to skip, and whether to self-report success. Three layers of prompt interpretation (Forge prompt → AX prompt → GSD prompt) create stochastic failure modes that are fatal for unattended operation.

Forge solves this by moving orchestration into **code**:

- **Code decides** what runs next (not a prompt-following agent)
- **Code verifies** each step completed (not agent self-report)
- **Code retries** on failure with error context (not "try again")
- **Code manages** context windows (fresh per step, not accumulated)
- **Code enforces** budgets, timeouts, and quality gates

## Two-Mode Architecture

### Mode 1: Interactive Requirements Gathering

Forge starts by having a deep conversation with the user. This is the only interactive phase. The agent asks about:

- Core functionality and user workflows
- Edge cases, error handling, failure modes
- Performance requirements, scale expectations
- Security model, auth flows, data sensitivity
- Deployment targets, infrastructure preferences
- Third-party integrations, API dependencies
- QA strategy, acceptance criteria
- Observability needs (logging, metrics, alerting)

This produces a comprehensive requirements document. The quality of this phase determines everything — if requirements are thorough, autonomous execution succeeds. If requirements are vague, it fails.

### Mode 2: Autonomous Execution

Once requirements are locked, Forge enters fully autonomous mode. No human interaction unless a genuine human gate is hit. The pipeline:

```
Requirements Doc
  → GSD new-project (research, roadmap)
  → For each phase:
      → GSD plan-phase (research → plan → verify plan)
      → GSD execute-phase (implement with atomic commits)
      → Programmatic verification (tests, linting, type checks)
      → Docker-based integration/scenario testing
      → Gap closure if verification fails
  → System scaffolding (CI/CD, observability, deployment)
  → Final verification (full test suite, Docker smoke test)
  → Done
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Forge (Node.js process, stays alive)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ State Manager │  │ Cost Control │  │ Human Gates  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                  │               │
│  ┌──────▼─────────────────▼──────────────────▼──────┐       │
│  │                 Pipeline Controller               │       │
│  │                                                   │       │
│  │  For each step:                                   │       │
│  │    1. Build prompt (code, not prompt templates)    │       │
│  │    2. query() → Agent SDK → fresh CC context      │       │
│  │    3. Parse structured output                     │       │
│  │    4. Verify programmatically (code checks)       │       │
│  │    5. Decide next step (code logic, not agent)    │       │
│  └───────────────────┬──────────────────────────────┘       │
│                      │                                       │
│  ┌───────────────────▼──────────────────────────────┐       │
│  │              Agent SDK query()                    │       │
│  │                                                   │       │
│  │  - IS Claude Code (same tools: Read, Write,       │       │
│  │    Edit, Bash, Glob, Grep, WebSearch, etc.)       │       │
│  │  - Fresh context per call                         │       │
│  │  - bypassPermissions mode                         │       │
│  │  - Budget + turn limits                           │       │
│  │  - GSD skills available as slash commands         │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
│  Verification is CODE, not agent self-report:                │
│    - fs.existsSync() for expected files                      │
│    - Parse test output (jest --json, go test -json)          │
│    - Check git log for expected commits                      │
│    - Docker compose up → run tests → parse exit code         │
│    - Lint/typecheck exit codes                               │
└──────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime:** Node.js / TypeScript
- **Core dependency:** `@anthropic-ai/claude-agent-sdk`
- **GSD:** Available as slash commands inside CC (the Agent SDK provides full CC)
- **State:** `forge-state.json` in project root
- **Config:** `forge.config.json` in project root
- **Verification:** Programmatic checks in Node.js code

## How Forge Uses GSD (Without AX)

Forge calls GSD skills directly via Agent SDK. Each `query()` call gets a fresh Claude Code instance with GSD's slash commands available. Forge's code controls *what* runs and *when* — the agent only does the focused work.

### Why Not AX?

AX is a prompt-based orchestrator — it reads markdown instructions and follows them. This works interactively but has stochastic failure modes for unattended operation:

| Problem | AX (Prompt-Based) | Forge (Code-Based) |
|---|---|---|
| Step skipping | Agent decides to skip steps | Code runs every step, verifies each |
| Hallucinated completion | Agent says "done" without doing work | Code checks: files exist? tests pass? |
| Error handling | Agent may ignore failures | Code parses exit codes, retries |
| Context accumulation | Prompt grows, agent forgets earlier steps | Fresh context per step |
| Verification | Agent self-reports "all tests pass" | Code runs tests, parses JSON output |

### GSD Skills Forge Calls Directly

| GSD Skill | What Forge Uses It For |
|---|---|
| `/gsd:new-project` | Initial project setup (research, requirements, roadmap) |
| `/gsd:plan-phase N` | Create phase plan (research → plan → verify) |
| `/gsd:execute-phase N` | Implement the plan (atomic commits) |
| `/gsd:verify-work N` | Goal-backward verification |
| `/gsd:audit-milestone` | Verify milestone completion |
| `/gsd:complete-milestone` | Archive and tag |

Each skill runs inside its own `query()` call with a fresh context. Forge doesn't chain them in a single prompt — it runs one, verifies the result programmatically, then runs the next.

## How the Agent SDK Works

The Agent SDK is Claude Code as a library. Same tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch), same agent loop, same context management. It spawns a CC process under the hood.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Each step gets its own query() call — fresh context
for await (const message of query({
  prompt: `You are executing phase 3 of this project.

    Here is the phase plan:
    ${phasePlan}

    Here is the project context:
    ${projectContext}

    Run /gsd:execute-phase 3

    When done, output a JSON block with:
    - files_created: string[]
    - files_modified: string[]
    - tests_added: number
    - commits: string[]`,
  options: {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
    permissionMode: "bypassPermissions",
    maxTurns: 200,
    maxBudgetUsd: 15.00,
    model: "claude-opus-4-6",
  }
})) {
  // Forge code processes messages, extracts structured output
}

// THEN: Forge code verifies (not the agent)
const testResult = execSync("npm test -- --json");
const parsed = JSON.parse(testResult);
if (parsed.numFailedTests > 0) {
  // Forge code decides to retry with error context
}
```

### Key SDK Features

| Feature | What It Does | How We Use It |
|---|---|---|
| `query()` | Async generator, runs a full agent session | One call per pipeline step |
| `permissionMode: "bypassPermissions"` | No permission prompts | Fully autonomous |
| `maxBudgetUsd` | Dollar cap per session | Cost control per step |
| `maxTurns` | Turn limit per session | Prevent runaway agents |
| `agents` | Define subagents within a session | Parallel work within a step |
| `mcpServers` | MCP connections | Notion, external services |
| `resume` / `sessionId` | Session management | Resume interrupted steps |
| `hooks` | Lifecycle callbacks | Monitor progress, log events |

### Agent SDK vs Other Options

| Approach | Why Not |
|---|---|
| Raw Claude API | Would require rebuilding all CC tools from scratch |
| CC Headless (`claude -p`) | No programmatic message control, harder error handling |
| CC Interactive | Returns to user, context fills up, needs manual resume |
| AX over CC | Stochastic failures — agent can skip steps, self-report false success |
| **Agent SDK** | **CC as a library. All tools built in. Programmatic control. Fresh context per call.** |

## Core Components

### 1. CLI Entry Point (`forge`)

```bash
# Deep requirements gathering (interactive)
forge init

# Run all phases autonomously (walk away)
forge run

# Run a single phase
forge phase 3

# Check status
forge status

# Resume after human gate or interruption
forge resume
```

### 2. Requirements Gatherer

The most critical component. Runs during `forge init` and produces a comprehensive requirements document that drives everything else.

```typescript
// Interactive — this is the only human-in-the-loop phase
const requirements = await gatherRequirements({
  // Agent asks deep questions about:
  topics: [
    "core_functionality",    // What does the system do?
    "user_workflows",        // How do users interact with it?
    "edge_cases",            // What can go wrong?
    "data_model",            // What data, how structured?
    "auth_security",         // Who can do what?
    "integrations",          // Third-party services?
    "performance",           // Scale, latency, throughput?
    "deployment",            // Where does it run?
    "observability",         // Logging, metrics, alerting?
    "acceptance_criteria",   // How do we know it's done?
  ]
});

// Output: structured requirements doc saved to project
```

### 3. Pipeline Controller

The main loop. Pure code — no prompt-based orchestration.

```typescript
async function runPipeline(state: ForgeState) {
  // Step 1: Project setup via GSD
  if (!state.projectInitialized) {
    await runStep("gsd-new-project", {
      prompt: buildNewProjectPrompt(state.requirements),
      verify: async () => {
        return fs.existsSync(".planning/ROADMAP.md")
          && fs.existsSync(".planning/PROJECT.md");
      }
    });
  }

  // Step 2: System scaffolding (CI, Docker, observability)
  if (!state.scaffolded) {
    await runStep("scaffold", {
      prompt: buildScaffoldPrompt(state),
      verify: async () => {
        return fs.existsSync(".github/workflows/ci.yml")
          && fs.existsSync("Dockerfile")
          && fs.existsSync("docker-compose.yml");
      }
    });
  }

  // Step 3: Execute each phase
  const phases = parseRoadmap(".planning/ROADMAP.md");
  for (const phase of phases) {
    if (state.phases[phase.number]?.status === "completed") continue;

    await runPhase(phase, state);
  }

  // Step 4: Final verification
  await runFinalVerification(state);
}
```

### 4. Phase Runner

Runs a single phase through the full cycle: plan → execute → verify → gap close.

```typescript
async function runPhase(phase: Phase, state: ForgeState) {
  // Plan
  await runStep("plan", {
    prompt: `Run /gsd:plan-phase ${phase.number}. ${phase.context}`,
    verify: async () => {
      return fs.existsSync(`.planning/phases/phase-${phase.number}/PLAN.md`);
    }
  });

  // Execute
  await runStep("execute", {
    prompt: `Run /gsd:execute-phase ${phase.number}`,
    verify: async () => {
      // Check git log for commits
      const log = execSync(`git log --oneline -20`).toString();
      return log.includes(`phase-${phase.number}`);
    }
  });

  // Test
  const testResults = await runTests(state.config);

  // Gap closure if tests fail
  if (testResults.failures > 0) {
    for (let attempt = 0; attempt < state.config.maxRetries; attempt++) {
      await runStep("gap-closure", {
        prompt: buildGapClosurePrompt(testResults, phase),
        verify: async () => {
          const retry = await runTests(state.config);
          return retry.failures === 0;
        }
      });
    }
  }

  // Verify
  await runStep("verify", {
    prompt: `Run /gsd:verify-work ${phase.number}`,
    verify: async () => true // GSD verify is advisory
  });

  state.phases[phase.number] = { status: "completed", ...testResults };
  saveState(state);
}
```

### 5. Programmatic Verification

The key insight from StrongDM: **writing code is easy, verifying it's correct is the hard part.** Forge never trusts agent self-report.

```typescript
// Every verification is CODE, not a prompt
interface Verifier {
  name: string;
  check: () => Promise<{ passed: boolean; details: string }>;
}

const verifiers: Verifier[] = [
  {
    name: "files-exist",
    check: async () => {
      const expected = getExpectedFiles(phase);
      const missing = expected.filter(f => !fs.existsSync(f));
      return { passed: missing.length === 0, details: `Missing: ${missing}` };
    }
  },
  {
    name: "tests-pass",
    check: async () => {
      const result = execSync("npm test -- --json", { encoding: "utf8" });
      const parsed = JSON.parse(result);
      return {
        passed: parsed.numFailedTests === 0,
        details: `${parsed.numPassedTests} passed, ${parsed.numFailedTests} failed`
      };
    }
  },
  {
    name: "typecheck",
    check: async () => {
      try {
        execSync("npx tsc --noEmit");
        return { passed: true, details: "No type errors" };
      } catch (e) {
        return { passed: false, details: e.stderr };
      }
    }
  },
  {
    name: "lint",
    check: async () => {
      try {
        execSync("npm run lint");
        return { passed: true, details: "No lint errors" };
      } catch (e) {
        return { passed: false, details: e.stderr };
      }
    }
  },
  {
    name: "docker-smoke",
    check: async () => {
      try {
        execSync("docker compose up -d && docker compose run --rm test");
        return { passed: true, details: "Docker smoke test passed" };
      } catch (e) {
        return { passed: false, details: e.stderr };
      } finally {
        execSync("docker compose down");
      }
    }
  }
];
```

### 6. State Manager

Persists orchestrator state to `forge-state.json`:

```json
{
  "project_dir": "/path/to/project",
  "started_at": "2026-03-04T...",
  "model": "claude-opus-4-6",
  "requirements_doc": "REQUIREMENTS.md",
  "project_initialized": true,
  "scaffolded": true,
  "phases": {
    "1": {
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "attempts": 1,
      "test_results": { "passed": 12, "failed": 0, "total": 12 },
      "verifications": {
        "files-exist": true,
        "tests-pass": true,
        "typecheck": true,
        "lint": true,
        "docker-smoke": true
      },
      "budget_used": 4.23
    },
    "2": {
      "status": "in_progress",
      "started_at": "...",
      "attempts": 2,
      "last_error": "docker-smoke: exit code 1, container failed health check"
    }
  },
  "total_budget_used": 4.23,
  "max_budget": 200.00
}
```

### 7. Retry Logic

```
Step fails verification
  → Attempt 1: re-run with error context + failing test output
  → Attempt 2: re-run with simplified scope (focus on failing tests only)
  → Attempt 3: stop, log failure details, notify user
```

Max retries configurable. Default: 3 per step.

### 8. Human Gate Handler

Some things genuinely need a human:
- Creating cloud accounts (AWS, Stripe, etc.)
- Entering API keys
- Making payments
- OAuth app registration

When detected:
1. Pause the pipeline
2. Log exactly what's needed to stdout and `forge-state.json`
3. Wait for user to run `forge resume` after completing the action
4. Optional: webhook/Slack notification

### 9. Cost Controller

- Per-step budget: `maxBudgetUsd` on each `query()` call
- Total project budget: tracked in state, abort if exceeded
- Per-phase budget: sum of steps within a phase
- Log cost per step for full visibility

## What Forge Builds (Full Production System)

Forge doesn't just write application code. It builds everything a production system needs:

| Category | What Gets Built |
|---|---|
| **Application Code** | Core functionality, API endpoints, data models, business logic |
| **Testing** | Unit tests, integration tests, scenario/E2E tests, test fixtures |
| **CI/CD** | GitHub Actions workflows (lint → test → build → deploy) |
| **Containerization** | Dockerfile, docker-compose.yml, docker-compose.test.yml |
| **Observability** | Structured logging, health checks, metrics endpoints |
| **Security** | Input validation, auth middleware, CORS, rate limiting |
| **Deployment** | Deploy configs (Vercel/Railway/Fly/K8s), environment management |
| **Documentation** | API docs, architecture notes, deployment runbook |

## Config File (`forge.config.json`)

```json
{
  "model": "claude-opus-4-6",
  "max_budget_total": 200.00,
  "max_budget_per_step": 15.00,
  "max_retries": 3,
  "max_turns_per_step": 200,
  "testing": {
    "unit_command": "npm test -- --json",
    "integration_command": "npm run test:integration -- --json",
    "scenario_command": "npm run test:e2e",
    "docker_compose_file": "docker-compose.test.yml"
  },
  "verification": {
    "typecheck": true,
    "lint": true,
    "docker_smoke": true
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

1. **Interactive requirements gathering** — deep conversation with user about what to build
2. Writes `REQUIREMENTS.md` with structured requirements
3. Runs GSD new-project via `query()` (research, roadmap creation)
4. Detects stack, configures testing commands
5. Writes `forge.config.json` and `forge-state.json`
6. Displays summary — user can now walk away

### `forge run`

1. Reads state — find first incomplete step
2. If project not initialized: run GSD new-project
3. If not scaffolded: scaffold CI/CD, Docker, observability
4. For each remaining phase:
   a. Plan via `query()` with GSD plan-phase
   b. Execute via `query()` with GSD execute-phase
   c. Verify programmatically (tests, typecheck, lint, Docker)
   d. On verification failure: gap close up to max retries
   e. On human-needed: pause, wait for `forge resume`
5. Final verification: full test suite + Docker smoke test
6. Exit with summary

### `forge phase N`

Run a single phase through the full cycle. Same as one iteration of the phase loop in `forge run`.

### `forge status`

Read `forge-state.json`, display:
- Phase progress table
- Test results per phase
- Verification status per phase
- Budget used (per phase and total)
- Current step if in progress

### `forge resume`

Continue from where `forge run` paused (human gate or failure).

## StrongDM Learnings Applied

StrongDM's dark factory (Attractor) is the only known production Level 4 autonomous coding system. Key insights applied to Forge:

| StrongDM Pattern | Forge Implementation |
|---|---|
| **Spec → Implementation** (never open-ended) | Deep requirements doc drives everything |
| **Digital Twin Testing** | Docker-based test environments |
| **Holdout Evaluation** (separate AI evaluates) | Programmatic verification (code, not AI opinion) |
| **Pipeline, not Chat** | Code-based orchestration, not prompt chaining |
| **Cost Awareness** (~$1K/day) | Per-step budgets, total project budget |
| **Failure is Expected** | Retry with context, gap closure loops |

## Competitive Context

| Tool | Autonomous? | Multi-Phase? | Verification | Full System? |
|---|---|---|---|---|
| Devin | Yes | Weak | Agent self-report | Code only |
| Cursor Cloud | Yes | Moderate | Agent self-report | Code only |
| OpenAI Codex | Yes | Weak | Sandboxed tests | Code only |
| CC + AX | Semi (returns) | Strong | Mixed | Partial |
| StrongDM Attractor | Yes | Strong | Digital twin + holdout | Yes |
| **Forge** | **Yes** | **Strong** | **Programmatic** | **Yes** |

## Success Criteria

### v1 (MVP)
- [ ] `forge init` gathers deep requirements interactively
- [ ] `forge run` executes all phases without returning to user
- [ ] Each step gets a fresh context via separate `query()` call
- [ ] GSD skills called directly (no AX layer)
- [ ] Programmatic verification after every step (not agent self-report)
- [ ] Failed steps retry up to 3 times with error context
- [ ] Human gates pause and resume cleanly
- [ ] State persists across interruptions
- [ ] Cost tracked per step and total
- [ ] CI/CD scaffolded automatically
- [ ] Docker-based test environment set up

### v2
- [ ] Agent Teams for intra-phase parallelism
- [ ] Docker-based scenario testing (spin up full system, run E2E)
- [ ] Webhook/Slack notifications for human gates
- [ ] Dashboard showing phase progress, costs, test results
- [ ] Holdout evaluation (separate AI reviews against requirements)
- [ ] Multiple concurrent projects
- [ ] Deployment automation

## File Structure

```
forge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point (commander.js)
│   ├── pipeline.ts           # Main pipeline controller
│   ├── requirements.ts       # Interactive requirements gatherer
│   ├── phase-runner.ts       # Runs a single phase (plan → execute → verify → gap close)
│   ├── step-runner.ts        # Runs a single query() step with verification
│   ├── verifiers/
│   │   ├── index.ts          # Verifier registry
│   │   ├── files.ts          # File existence checks
│   │   ├── tests.ts          # Test runner + JSON output parser
│   │   ├── typecheck.ts      # TypeScript/language type checking
│   │   ├── lint.ts           # Linter checks
│   │   └── docker.ts         # Docker-based smoke/integration tests
│   ├── state.ts              # State manager (read/write forge-state.json)
│   ├── config.ts             # Config file management
│   ├── cost.ts               # Budget tracking and enforcement
│   ├── human-gate.ts         # Handles human-needed pauses
│   └── prompts.ts            # Prompt builders for each step type
├── forge.config.json         # Project config (template)
└── README.md
```

## Relationship to AX

AX and Forge are siblings, not parent-child:

```
                   GSD (core planning/execution engine)
                  /                                    \
         AX (interactive)                       Forge (autonomous)
         - Runs inside CC                       - Runs outside CC
         - User drives workflow                 - Code drives workflow
         - Prompt-based orchestration           - Code-based orchestration
         - Good for hands-on development        - Good for "walk away" building
         - Tests via agent execution            - Tests via programmatic verification
```

Both use GSD's skills directly. AX wraps them in markdown prompts for interactive CC use. Forge wraps them in TypeScript code for autonomous operation. You can use AX for quick interactive work and Forge for full autonomous builds.
