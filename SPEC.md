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

### Mode 2: Autonomous Execution (Wave Model)

Once requirements are locked, Forge enters fully autonomous mode. Execution happens in **waves** — Forge maximizes autonomous progress before ever involving a human.

```
Wave 1: Build Everything Possible
  → GSD new-project (research, roadmap)
  → System scaffolding (CI/CD, Docker, observability)
  → For each phase:
      → If phase needs external service (Stripe, AWS, etc.):
          → Build the full integration with mocks/stubs
          → Flag service as "needs real credentials"
      → If phase has no blockers:
          → Build normally (plan → execute → verify)
      → If phase hits unexpected blocker:
          → 1. Retry with different approach
          → 2. Skip and flag, continue other phases
          → 3. Stop only if nothing else can proceed
  → Result: codebase is ~95% complete, all automatable work done

Human Checkpoint (ONE interruption, batched)
  → "Here's everything I need from you:"
  →   □ Stripe: need secret key + webhook secret (signup: stripe.com)
  →   □ AWS S3: need access key, secret, bucket name
  →   □ 2 skipped items that need your guidance:
  →       - WebSocket auth: tried ws + socket.io, both failed on X
  →       - PDF export: puppeteer won't install, jsPDF can't match layout
  → User provides credentials, guidance on skipped items
  → `forge resume --env .env.production`

Wave 2: Real Integration + Fixes
  → Swap mocks for real service implementations
  → Run integration tests against real APIs
  → Fix issues (real APIs ≠ mocks — auth flows, rate limits, etc.)
  → Address skipped items with user's guidance

Wave 3+: Spec Compliance Loop
  → For each requirement in REQUIREMENTS.md:
      → Has passing test?
      → Programmatic check passes?
  → If gaps found: fix → retest → check again
  → Each loop should have fewer issues (convergence)
  → If not converging after N rounds: stop, report what's left
  → EXIT CONDITION: every requirement has a passing verification

  Not "all phases ran" — "all requirements verified."
```

### Failure Cascade (For Unexpected Blockers)

When Forge hits something it didn't anticipate — a library doesn't work, an API changed, a dependency conflict — it follows this cascade:

1. **Retry with different approach** — Agent tried library X, didn't work → retry with "don't use X, find an alternative." Up to 3 attempts with different strategies.
2. **Skip and flag** — Can't solve it after retries → mark the item as blocked, record what was tried and why it failed, continue building everything else that doesn't depend on it.
3. **Stop and report** — Only if the blocker is so fundamental that nothing else can proceed (e.g., the core framework won't compile).

This means Forge always maximizes progress. When it does involve a human (at the checkpoint), the report includes both service credentials needed AND any skipped items with full context:

```json
{
  "human_checkpoint": {
    "services_needed": [
      {
        "service": "stripe",
        "why": "Payment processing in Phase 5",
        "signup_url": "https://stripe.com",
        "credentials_needed": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        "mocked_in": ["src/payments/", "test/payments/"]
      }
    ],
    "skipped_items": [
      {
        "requirement": "R7: WebSocket real-time updates",
        "phase": 4,
        "attempts": [
          { "approach": "ws library", "error": "auth handshake timeout" },
          { "approach": "socket.io", "error": "CORS policy blocks ws upgrade" }
        ],
        "code_so_far": "src/ws/ (socket.io wired up, failing at test/ws.test.ts:34)",
        "suggestion": "May need custom CORS config or different transport"
      }
    ],
    "completed": "14/16 requirements verified",
    "resume_command": "forge resume --env .env.production"
  }
}
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

The main loop. Implements the wave model — build everything possible, batch human needs, integrate, verify until spec compliance.

```typescript
async function runPipeline(state: ForgeState) {
  // ─── WAVE 1: Build everything possible ───

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

  // Step 3: Execute each phase (mock external services, skip-and-flag on blockers)
  const phases = parseRoadmap(".planning/ROADMAP.md");
  for (const phase of phases) {
    if (state.phases[phase.number]?.status === "completed") continue;

    const externalServices = detectExternalServices(phase);
    const result = await runPhase(phase, state, {
      mockServices: externalServices,  // Build with mocks, don't stop
      onBlocker: "retry-then-skip",    // Cascade: retry → skip → continue
    });

    if (result.skipped.length > 0) {
      state.skippedItems.push(...result.skipped);
    }
    if (externalServices.length > 0) {
      state.servicesNeeded.push(...externalServices);
    }
  }

  // ─── HUMAN CHECKPOINT (if needed) ───

  if (state.servicesNeeded.length > 0 || state.skippedItems.length > 0) {
    await pauseForHuman(state);
    // User runs: forge resume --env .env.production
    // Forge reads provided credentials + guidance
  }

  // ─── WAVE 2: Real integration + fixes ───

  if (state.servicesNeeded.length > 0) {
    await runStep("integrate-real-services", {
      prompt: buildIntegrationPrompt(state.servicesNeeded, state.credentials),
      verify: async () => {
        const results = await runIntegrationTests(state.config);
        return results.failures === 0;
      }
    });
  }

  if (state.skippedItems.length > 0) {
    for (const item of state.skippedItems) {
      await runStep(`fix-skipped-${item.requirement}`, {
        prompt: buildSkippedItemPrompt(item, state.humanGuidance),
        verify: async () => {
          return await verifyRequirement(item.requirement, state);
        }
      });
    }
  }

  // ─── WAVE 3+: Spec compliance loop ───

  await runSpecComplianceLoop(state);
}

async function runSpecComplianceLoop(state: ForgeState) {
  const requirements = parseRequirements("REQUIREMENTS.md");
  let round = 0;
  const maxRounds = 5;

  while (round < maxRounds) {
    round++;
    const gaps: RequirementGap[] = [];

    for (const req of requirements) {
      const result = await verifyRequirement(req, state);
      if (!result.passed) {
        gaps.push({ requirement: req, ...result });
      }
    }

    if (gaps.length === 0) {
      // ALL REQUIREMENTS VERIFIED — we're done
      state.status = "completed";
      saveState(state);
      return;
    }

    // Check convergence — are we making progress?
    const prevGapCount = state.gapHistory[round - 1] || Infinity;
    if (gaps.length >= prevGapCount) {
      // Not converging — stop and report
      state.status = "stuck";
      state.remainingGaps = gaps;
      saveState(state);
      await pauseForHuman(state);
      return;
    }

    state.gapHistory[round] = gaps.length;

    // Fix gaps
    for (const gap of gaps) {
      await runStep(`gap-closure-r${round}`, {
        prompt: buildGapClosurePrompt(gap),
        verify: async () => {
          const retry = await verifyRequirement(gap.requirement, state);
          return retry.passed;
        }
      });
    }
  }
}
```

### 4. Phase Runner

Runs a single phase. Handles external service mocking and the retry→skip→stop cascade for unexpected blockers.

```typescript
async function runPhase(
  phase: Phase,
  state: ForgeState,
  opts: { mockServices: Service[]; onBlocker: "retry-then-skip" }
): Promise<PhaseResult> {
  const skipped: SkippedItem[] = [];

  // Plan
  await runStep("plan", {
    prompt: buildPlanPrompt(phase, opts.mockServices),
    verify: async () => {
      return fs.existsSync(`.planning/phases/phase-${phase.number}/PLAN.md`);
    }
  });

  // Execute (with mock instructions for external services)
  const executeResult = await runStepWithCascade("execute", {
    prompt: buildExecutePrompt(phase, opts.mockServices),
    verify: async () => {
      const log = execSync(`git log --oneline -20`).toString();
      return log.includes(`phase-${phase.number}`);
    },
    // The cascade: retry with different approach → skip → continue
    onFailure: async (error, attempt) => {
      if (attempt < 3) {
        // Retry with different approach
        return {
          action: "retry",
          newPrompt: buildRetryPrompt(phase, error, attempt)
        };
      } else {
        // Skip and flag
        skipped.push({
          requirement: phase.requirements,
          phase: phase.number,
          attempts: error.history,
          codeSoFar: await getPartialWork(phase),
        });
        return { action: "skip" };
      }
    }
  });

  // Test (only if execution succeeded)
  if (executeResult.status !== "skipped") {
    const testResults = await runTests(state.config);

    if (testResults.failures > 0) {
      // Gap closure within the phase
      for (let attempt = 0; attempt < state.config.maxRetries; attempt++) {
        await runStep("gap-closure", {
          prompt: buildPhaseGapPrompt(testResults, phase),
          verify: async () => {
            const retry = await runTests(state.config);
            return retry.failures === 0;
          }
        });
        const retest = await runTests(state.config);
        if (retest.failures === 0) break;
      }
    }
  }

  state.phases[phase.number] = {
    status: skipped.length > 0 ? "partial" : "completed",
    skipped,
  };
  saveState(state);

  return { skipped };
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

Persists orchestrator state to `forge-state.json`. Tracks waves, skipped items, service needs, and convergence history:

```json
{
  "project_dir": "/path/to/project",
  "started_at": "2026-03-04T...",
  "model": "claude-opus-4-6",
  "requirements_doc": "REQUIREMENTS.md",
  "status": "wave_2",
  "current_wave": 2,
  "project_initialized": true,
  "scaffolded": true,
  "phases": {
    "1": {
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "attempts": 1,
      "test_results": { "passed": 12, "failed": 0, "total": 12 },
      "budget_used": 4.23
    },
    "3": {
      "status": "partial",
      "started_at": "...",
      "attempts": 1,
      "mocked_services": ["stripe"],
      "budget_used": 6.10
    },
    "4": {
      "status": "completed",
      "started_at": "...",
      "completed_at": "...",
      "attempts": 2,
      "budget_used": 8.44
    }
  },
  "services_needed": [
    {
      "service": "stripe",
      "why": "Payment processing in Phase 3",
      "signup_url": "https://stripe.com",
      "credentials_needed": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      "mocked_in": ["src/payments/", "test/payments/"]
    }
  ],
  "skipped_items": [
    {
      "requirement": "R7: WebSocket real-time updates",
      "phase": 4,
      "attempts": [
        { "approach": "ws library", "error": "auth handshake timeout" },
        { "approach": "socket.io", "error": "CORS policy blocks ws upgrade" }
      ],
      "code_so_far": "src/ws/"
    }
  ],
  "spec_compliance": {
    "total_requirements": 16,
    "verified": 14,
    "gap_history": [16, 5, 2, 0],
    "rounds_completed": 4
  },
  "total_budget_used": 18.77,
  "max_budget": 200.00
}
```

### 7. Failure Handling

Forge uses a three-tier cascade for ALL failures — expected or unexpected:

**Tier 1: Retry with different approach** (up to 3 attempts)
```
Attempt 1: re-run with error context + failing output
Attempt 2: re-run with explicit "don't use X, try alternative"
Attempt 3: re-run with simplified scope
```

**Tier 2: Skip and flag**
- Mark the item as blocked with full context (what was tried, why it failed, code so far)
- Continue building everything else that doesn't depend on it
- Include in the human checkpoint report

**Tier 3: Stop and report**
- Only if the blocker prevents ALL other work from proceeding
- Dump full context: error logs, partial state, what was completed
- Wait for human guidance via `forge resume`

The goal: **always maximize autonomous progress.** Stopping is the last resort, not the first response.

### 8. Human Checkpoint (Batched)

Forge collects ALL human needs during Wave 1 and presents them in ONE interruption:

**What gets batched:**
- External service credentials (Stripe, AWS, SendGrid, etc.)
- Skipped items needing human guidance
- Design decisions the agent couldn't resolve

**What the checkpoint looks like:**
```
═══════════════════════════════════════════════
  FORGE — Human Checkpoint
═══════════════════════════════════════════════

  Wave 1 complete: 14/16 requirements built

  Services needed (please sign up + provide keys):
  ┌─────────┬─────────────────────────────────┐
  │ Stripe  │ stripe.com → secret key +       │
  │         │ webhook secret                   │
  │ AWS S3  │ aws.amazon.com → access key,    │
  │         │ secret, bucket name              │
  └─────────┴─────────────────────────────────┘

  Skipped items (need your guidance):
  ┌──────────────────────────────────────────────┐
  │ R7: WebSocket auth — tried ws + socket.io,   │
  │ both fail on auth handshake. Code at src/ws/. │
  │ Need: custom CORS config? Different transport?│
  └──────────────────────────────────────────────┘

  Add credentials to .env.production, then run:
  $ forge resume --env .env.production

═══════════════════════════════════════════════
```

After the user provides credentials and guidance, `forge resume` picks up exactly where it left off — swaps mocks for real implementations, addresses skipped items, then enters the spec compliance loop.

### 9. Cost Controller

- Per-step budget: `maxBudgetUsd` on each `query()` call
- Total project budget: tracked in state, abort if exceeded
- Per-phase budget: sum of steps within a phase
- Per-wave budget: sum of phases within a wave
- Log cost per step for full visibility
- Budget is a hard stop — never exceeded, even mid-step

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

1. **Interactive requirements gathering** — deep, thorough conversation with user
   - Core functionality, user workflows, edge cases
   - Security, auth, data model
   - External services needed (identifies potential human gates early)
   - Performance, deployment, observability
   - Acceptance criteria for every feature
2. Writes `REQUIREMENTS.md` with structured, numbered requirements
3. Runs GSD new-project via `query()` (research, roadmap creation)
4. Detects stack, configures testing commands
5. Identifies external services → creates service manifest in state
6. Writes `forge.config.json` and `forge-state.json`
7. Displays summary — user can now walk away

### `forge run`

The main command. Implements the full wave model:

**Wave 1** — Build everything possible:
1. Reads state — find current wave and position
2. If project not initialized: run GSD new-project
3. If not scaffolded: scaffold CI/CD, Docker, observability
4. For each phase:
   - Phases needing external services → build with mocks
   - Phases hitting unexpected blockers → retry (3x) → skip → continue
   - Phases with no blockers → build normally
5. Result: codebase ~95% complete

**Human Checkpoint** — ONE interruption (if needed):
6. Present batched report: services needed + skipped items
7. Wait for `forge resume`

**Wave 2** — Real integration:
8. Swap mocks for real service implementations
9. Run integration tests against real APIs
10. Address skipped items with user guidance

**Wave 3+** — Spec compliance loop:
11. Verify every requirement in REQUIREMENTS.md
12. Fix gaps, retest
13. Loop until converging (each round fewer gaps)
14. Exit when all requirements verified OR not converging (report to user)

### `forge phase N`

Run a single phase through the full cycle. Follows same retry→skip→stop cascade. Does NOT trigger the wave model — just runs that one phase.

### `forge status`

Read `forge-state.json`, display:
- Current wave and position
- Phase progress table (completed / partial / skipped / pending)
- Services needed (with mock status)
- Skipped items (with attempt history)
- Spec compliance (X/Y requirements verified)
- Budget used (per phase, per wave, total)

### `forge resume`

Continue from human checkpoint:
1. Reads `.env.production` (or provided env file) for new credentials
2. Reads any guidance for skipped items from user input
3. Enters Wave 2 (real integration + fixes)
4. Then Wave 3+ (spec compliance loop)

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

### v1
- [ ] `forge init` gathers deep requirements interactively, produces numbered REQUIREMENTS.md
- [ ] `forge run` implements full wave model (build → checkpoint → integrate → verify)
- [ ] Each step gets a fresh context via separate `query()` call
- [ ] GSD skills called directly (no AX layer)
- [ ] Programmatic verification after every step (not agent self-report)
- [ ] Failure cascade: retry (3x with different approaches) → skip and flag → stop only if fatal
- [ ] External services built with mocks in Wave 1, swapped in Wave 2
- [ ] ONE human checkpoint with batched report (services + skipped items)
- [ ] Spec compliance loop: verify every requirement, fix gaps, converge
- [ ] Exit condition is "all requirements verified" not "all phases ran"
- [ ] State persists across interruptions and waves
- [ ] Cost tracked per step, phase, wave, and total
- [ ] CI/CD, Docker, observability scaffolded automatically
- [ ] `forge resume` picks up exactly where it left off with new credentials/guidance

### v2
- [ ] Agent Teams for intra-phase parallelism
- [ ] Holdout evaluation (separate AI reviews against requirements, never sees implementation)
- [ ] Webhook/Slack notifications for human checkpoint
- [ ] Live dashboard showing wave progress, costs, spec compliance
- [ ] Multiple concurrent projects
- [ ] Deployment automation (push to production after spec compliance)
- [ ] Learning across projects (what approaches work for what problem types)

## File Structure

```
forge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point (commander.js)
│   ├── pipeline.ts           # Wave-based pipeline controller
│   ├── requirements.ts       # Interactive requirements gatherer
│   ├── phase-runner.ts       # Runs a single phase with mock support + cascade
│   ├── step-runner.ts        # Runs a single query() step with verification
│   ├── spec-compliance.ts    # Spec compliance loop (verify → fix → converge)
│   ├── service-detector.ts   # Detects external service needs from phase descriptions
│   ├── verifiers/
│   │   ├── index.ts          # Verifier registry
│   │   ├── files.ts          # File existence checks
│   │   ├── tests.ts          # Test runner + JSON output parser
│   │   ├── typecheck.ts      # TypeScript/language type checking
│   │   ├── lint.ts           # Linter checks
│   │   └── docker.ts         # Docker-based smoke/integration tests
│   ├── state.ts              # State manager (waves, services, skipped items, convergence)
│   ├── config.ts             # Config file management
│   ├── cost.ts               # Budget tracking and enforcement
│   ├── checkpoint.ts         # Batched human checkpoint (services + skipped items)
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
