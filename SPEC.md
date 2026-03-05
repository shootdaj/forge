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

## A Note on Code Examples

The TypeScript code blocks throughout this spec are **illustrative pseudocode** — they show the intended structure, data flow, and logic but are NOT production-ready implementations. When GSD builds this project:

- **Treat code blocks as starter scaffolding.** They communicate intent and architecture, not final implementation. GSD agents should improve, refactor, and fill in gaps during actual coding.
- **Function signatures and types are approximate.** The real implementation should follow proper TypeScript patterns, error handling, and the Agent SDK's actual API surface (verify against SDK docs at build time).
- **Helper functions are intentionally undefined.** Functions like `buildNewProjectPrompt()`, `parseRoadmap()`, `detectExternalServices()`, etc. describe WHAT should happen, not HOW. GSD agents should implement them properly with full error handling.
- **The spec describes behavior, not syntax.** If a code block and a prose section disagree, the prose is authoritative. Code blocks exist to make the prose concrete, not to be copy-pasted.

## Two-Mode Architecture

### Mode 1: Interactive Requirements Gathering

Forge starts by having a deep conversation with the user. This is the only interactive phase. The agent asks about 25+ topics across 8 categories:

- **Core:** functionality, user workflows, personas, edge cases
- **Data:** model, lifecycle, state management, sync strategy
- **Security & Compliance:** auth, SOC 2, HIPAA, GDPR, PCI DSS, WCAG
- **Integrations:** third-party services, notifications, payments, webhooks
- **Quality:** performance targets, error handling, offline resilience, validation
- **Infrastructure:** deployment, observability, CI/CD, environments, feature flags
- **UX:** design patterns, accessibility, i18n/RTL
- **Business:** launch scope (MVP vs full), success metrics, acceptance criteria

This produces a comprehensive, numbered requirements document (R1, R2, ...) where every requirement has acceptance criteria, edge cases, performance targets, security notes, and observability requirements. The quality of this phase determines everything — if requirements are thorough, autonomous execution succeeds. If requirements are vague, it fails.

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
| `/gsd:new-project` | Initial project setup — Forge passes its REQUIREMENTS.md so GSD skips its own questioning and goes straight to research + roadmap creation |
| `/gsd:discuss-phase N` | Phase context gathering — gray area identification, decision locking (Forge automates the responses based on requirements doc, only pauses if genuinely ambiguous) |
| `/gsd:plan-phase N` | Create phase plan (research → plan → verify). Forge then runs its own plan-checker on top of GSD's |
| `/gsd:execute-phase N` | Implement the plan (atomic commits with requirement IDs) |
| `/gsd:add-tests N` | Generate additional tests for completed phases based on UAT criteria |
| `/gsd:verify-work N` | Goal-backward verification |
| `/gsd:audit-milestone` | Verify milestone completion |
| `/gsd:complete-milestone` | Archive and tag |

Each skill runs inside its own `query()` call with a fresh context. Forge doesn't chain them in a single prompt — it runs one, verifies the result programmatically, then runs the next.

**Important:** When calling `/gsd:new-project`, Forge injects the already-gathered requirements so GSD doesn't re-ask questions the user already answered. The prompt includes: "Requirements have already been gathered. See REQUIREMENTS.md. Skip questioning and proceed directly to research and roadmap creation."

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
  // Agent asks deep questions across these topics:
  topics: [
    // ─── Core ───
    "core_functionality",    // What does the system do? What problem does it solve?
    "user_workflows",        // Step-by-step: how does a user accomplish each goal?
    "user_personas",         // Who are the users? Different roles/permissions?
    "edge_cases",            // What can go wrong? What are the boundary conditions?

    // ─── Data & State ───
    "data_model",            // What data exists? Relationships? Constraints?
    "data_lifecycle",        // How is data created, updated, archived, deleted?
    "state_management",      // Client state? Server state? Sync strategy?

    // ─── Security & Compliance ───
    "auth_security",         // Auth method? Roles/permissions? Session management?
    "compliance",            // SOC 2? HIPAA? GDPR? PCI DSS? Accessibility (WCAG)?
                             // → If yes: drives audit logging, encryption, access controls,
                             //   data retention policies, consent flows, audit trails

    // ─── Integrations ───
    "integrations",          // Third-party services? APIs consumed? Webhooks?
    "notifications",         // Email? Push? SMS? In-app? When and what triggers them?
    "payments",              // Billing model? Subscription? One-time? Free tier?

    // ─── Quality & Reliability ───
    "performance",           // Scale expectations? Latency targets? Throughput?
    "error_handling",        // How should errors surface to users? Retry strategy?
    "offline_resilience",    // What happens when dependencies are down?
    "data_validation",       // Input validation rules? Business rule constraints?

    // ─── Infrastructure ───
    "deployment",            // Where does it run? How many environments?
    "observability",         // Logging, metrics, alerting, health checks?
    "ci_cd",                 // Build/test/deploy pipeline preferences?
    "environments",          // Dev/staging/prod? Feature flags? Config management?

    // ─── UX & Design ───
    "ux_patterns",           // Design system? Component library? Responsive?
    "accessibility",         // WCAG level? Screen reader support? Keyboard nav?
    "i18n",                  // Multi-language? RTL support? Locale-specific formatting?

    // ─── Business Context ───
    "launch_scope",          // MVP vs full product? What can be deferred?
    "success_metrics",       // How do you measure if this works? KPIs?
    "acceptance_criteria",   // How do we know each feature is done?
  ]
});

// Output: structured requirements doc saved to project
```

The compliance topic is particularly important — a "yes" to SOC 2, HIPAA, GDPR, or PCI DSS fundamentally changes what gets built:

| Compliance | What It Adds to the Build |
|---|---|
| **SOC 2** | Audit logging on all data access, encryption at rest + in transit, access control reviews, change management documentation, incident response runbook |
| **HIPAA** | PHI encryption, access audit trail, BAA support, minimum necessary access, breach notification flow |
| **GDPR** | Consent management, data export (right to portability), data deletion (right to erasure), privacy policy, DPA support, cookie consent |
| **PCI DSS** | Tokenized card storage (never store raw), TLS everywhere, input validation, quarterly vulnerability scans, cardholder data flow diagram |
| **WCAG 2.1 AA** | Semantic HTML, ARIA labels, keyboard navigation, color contrast ratios, screen reader testing, focus management |

### 3. Pipeline Controller

The main loop. Implements the wave model — build everything possible, batch human needs, integrate, verify until spec compliance.

```typescript
async function runPipeline(state: ForgeState, config: ForgeConfig) {
  const requirements = parseRequirements(state.requirementsDoc); // loads from file each time

  // ─── WAVE 1: Build everything possible ───

  // Step 1: Project setup via GSD
  if (!state.projectInitialized) {
    await runStep("gsd-new-project", {
      prompt: buildNewProjectPrompt(requirements),
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

  // Step 3: Execute phases (parallel where possible, mock external services)
  const phases = parseRoadmap(".planning/ROADMAP.md");
  const graph = buildDependencyGraph(phases);
  const executionWaves = topologicalSort(graph); // [[1], [2, 3, 5], [4]]

  for (const wave of executionWaves) {
    const pendingPhases = wave.filter(p => state.phases[p.number]?.status !== "completed");
    if (pendingPhases.length === 0) continue;

    const runOne = async (phase: Phase) => {
      const externalServices = detectExternalServices(phase);
      const result = await runPhase(phase, state, {
        mockServices: externalServices,
        onBlocker: "retry-then-skip",
      });
      return { result, externalServices };
    };

    let phaseResults: { result: PhaseResult; externalServices: Service[] }[];
    if (pendingPhases.length === 1) {
      phaseResults = [await runOne(pendingPhases[0])];
    } else {
      // Run independent phases concurrently (max 3)
      phaseResults = await Promise.all(
        pendingPhases.slice(0, config.parallelism.maxConcurrentPhases).map(runOne)
      );
    }

    // Merge results into state AFTER all concurrent phases complete (avoid race condition)
    for (const { result, externalServices } of phaseResults) {
      if (result.skipped.length > 0) state.skippedItems.push(...result.skipped);
      if (externalServices.length > 0) state.servicesNeeded.push(...externalServices);
    }
    saveState(state);
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
        const results = await runIntegrationTests(config);
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

  // If compliance loop couldn't converge, stop — don't continue to UAT
  if (state.status === "stuck") return;

  // ─── UAT: Test like a real user (final gate) ───

  await runUserAcceptanceTesting(state);
  if (state.uatResults.status !== "passed") {
    // Gap closure → retry UAT
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      await runStep("uat-gap-closure", {
        prompt: buildUATGapClosurePrompt(state.uatResults),
        verify: async () => true, // verification happens in next UAT run
      });
      await runUserAcceptanceTesting(state);
      if (state.uatResults.status === "passed") break;
    }
    if (state.uatResults.status !== "passed") {
      state.status = "stuck";
      saveState(state);
      return; // UAT couldn't pass — stop and report
    }
  }

  // ─── FINISH: Milestone audit + completion ───

  const auditResult = await runStep("audit-milestone", {
    prompt: "Run /gsd:audit-milestone. Output gaps as JSON if any found.",
    verify: async () => fs.existsSync(".planning/AUDIT.md"),
  });

  // If audit finds gaps, create and execute gap phases
  if (auditResult.gaps && auditResult.gaps.length > 0) {
    await runStep("plan-milestone-gaps", {
      prompt: "Run /gsd:plan-milestone-gaps",
      verify: async () => true,
    });
    // Execute gap phases through the same phase runner
    for (const gapPhase of auditResult.gaps) {
      await runPhase(gapPhase, state, { mockServices: [], onBlocker: "retry-then-skip" });
    }
  }

  await runStep("complete-milestone", {
    prompt: "Run /gsd:complete-milestone",
    verify: async () => {
      const tags = execSync("git tag").toString();
      return tags.length > 0; // milestone creates a git tag
    },
  });

  // Publish final Notion documentation
  await updateFinalNotionDocs(state);

  state.status = "completed";
  saveState(state);
}

async function runSpecComplianceLoop(state: ForgeState) {
  const requirements = parseRequirements("REQUIREMENTS.md");
  let round = 0;
  const maxRounds = config.maxComplianceRounds;

  // Seed gap history with total requirements (round 0 = baseline).
  // This is intentionally generous — gives the first round room to improve
  // even if it doesn't fix everything. If round 1 has as many gaps as
  // total requirements, convergence fails immediately (correct).
  state.specCompliance.gapHistory[0] = requirements.length;

  let lastGaps: RequirementGap[] = [];

  while (round < maxRounds) {
    round++;
    const gaps: RequirementGap[] = [];

    for (const req of requirements) {
      const result = await verifyRequirement(req, state);
      if (!result.passed) {
        gaps.push({ requirement: req, ...result });
      }
    }

    state.specCompliance.gapHistory[round] = gaps.length;
    state.specCompliance.verified = requirements.length - gaps.length;
    state.specCompliance.roundsCompleted = round;

    if (gaps.length === 0) {
      // ALL REQUIREMENTS VERIFIED — we're done
      state.status = "completed";
      saveState(state);
      return;
    }

    // Check convergence — are we making progress?
    const prevGapCount = state.specCompliance.gapHistory[round - 1];
    if (gaps.length >= prevGapCount) {
      // Not converging — stop and report
      state.status = "stuck";
      state.remainingGaps = gaps;
      saveState(state);
      await pauseForHuman(state);
      return;
    }

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
    lastGaps = gaps;
  }

  // Exhausted maxRounds while still making progress but not done
  state.status = "stuck";
  state.remainingGaps = lastGaps;
  saveState(state);
  await pauseForHuman(state);
}
```

### 4. Phase Runner

Runs a single phase through the full cycle: context → plan → verify plan → execute → test → gap closure → docs. Handles external service mocking and the retry→skip→stop cascade.

```typescript
async function runPhase(
  phase: Phase,
  state: ForgeState,
  opts: { mockServices: Service[]; onBlocker: "retry-then-skip" }
): Promise<PhaseResult> {
  const skipped: SkippedItem[] = [];
  const phaseDir = `.planning/phases/phase-${phase.number}`;

  // ─── 1. Context Gathering (skip if CONTEXT.md exists) ───
  if (!fs.existsSync(`${phaseDir}/CONTEXT.md`)) {
    await runStep("context", {
      prompt: buildContextPrompt(phase, requirements),
      // Agent identifies gray areas, makes decisions, captures deferred ideas
      verify: async () => fs.existsSync(`${phaseDir}/CONTEXT.md`)
    });
  }

  // ─── 2. Plan (skip if PLAN.md exists) ───
  if (!fs.existsSync(`${phaseDir}/PLAN.md`)) {
    await runStep("plan", {
      prompt: buildPlanPrompt(phase, opts.mockServices),
      verify: async () => fs.existsSync(`${phaseDir}/PLAN.md`)
    });
  }

  // ─── 3. Verify Plan (code-based, not agent) ───
  const planIssues = await verifyPlan(phase, requirements);
  if (planIssues.missingTestTasks.length > 0) {
    // Inject test tasks into plan (deterministic code edit)
    await injectTestTasks(`${phaseDir}/PLAN.md`, planIssues.missingTestTasks);
  }
  if (planIssues.missingRequirements.length > 0) {
    // Re-plan with feedback
    await runStep("re-plan", {
      prompt: `Plan missing coverage for: ${planIssues.missingRequirements}. Update PLAN.md.`,
      verify: async () => {
        const recheck = await verifyPlan(phase, requirements);
        return recheck.missingRequirements.length === 0;
      }
    });
  }

  // ─── 4. Execute (with mock instructions + cascade) ───
  // runStepWithCascade wraps runStep with the failure cascade:
  // retry(3x with different approaches) → skip and flag → stop
  const executeResult = await runStepWithCascade("execute", {
    prompt: buildExecutePrompt(phase, opts.mockServices),
    verify: async () => {
      const log = execSync(`git log --oneline -20`).toString();
      return log.includes(`phase-${phase.number}`);
    },
    onFailure: async (error, attempt) => {
      if (attempt < 3) {
        return { action: "retry", newPrompt: buildRetryPrompt(phase, error, attempt) };
      } else {
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

  // ─── 5. Test + Gap Closure (only if execution succeeded) ───
  if (executeResult.status !== "skipped") {
    const testResults = await runTests(config);

    if (testResults.failures > 0) {
      for (let attempt = 0; attempt < config.maxRetries; attempt++) {
        // Diagnose root cause first, then fix
        const diagnosis = await diagnoseFailure(testResults, phase);
        const stepResult = await runStep("gap-closure", {
          prompt: buildTargetedFixPrompt(diagnosis),
          verify: async () => {
            const retry = await runTests(config);
            return retry.failures === 0;
          }
        });
        if (stepResult.verified) break;
      }
    }

    // ─── 6. Verify test coverage ───
    const coverageResult = await verifyTestCoverage(phase);
    if (!coverageResult.passed) {
      // Use gsd:add-tests to generate missing tests
      await runStep("add-tests", {
        prompt: `Run /gsd:add-tests ${phase.number}. Missing: ${coverageResult.details}`,
        verify: async () => {
          const recheck = await verifyTestCoverage(phase);
          return recheck.passed;
        }
      });
    }
  }

  // ─── 7. Verify work (generates VERIFICATION.md) ───
  // Steps 7-9 only run if execution wasn't entirely skipped
  if (executeResult.status !== "skipped") {
    await runStep("verify-work", {
      prompt: `Run /gsd:verify-work ${phase.number}`,
      verify: async () => fs.existsSync(`${phaseDir}/VERIFICATION.md`)
    });
  }

  // ─── 8. Update TEST_GUIDE.md ───
  if (executeResult.status !== "skipped") {
    await updateTraceabilityMatrix(phase, state);
  }

  // ─── 9. Update Notion docs (background) ───
  // Local files (PHASE_REPORT.md, GAPS.md) are source of truth.
  // Notion pages are the published version — synced from local files.
  const docsPromise = updateNotionDocs(phase, state);
  const reportPromise = generatePhaseReport(phase, state); // writes PHASE_REPORT.md + publishes to Notion
  // Don't await — runs in background while next phase starts

  state.phases[phase.number] = {
    status: skipped.length > 0 ? "partial" : "completed",
    startedAt: phaseStartTime,
    completedAt: skipped.length > 0 ? undefined : new Date().toISOString(),
    attempts: executeResult.attempts || 1,
    testResults: await getTestSummary(config),
    budgetUsed: phaseBudget,
    mockedServiceNames: opts.mockServices.length > 0 ? opts.mockServices.map(s => s.name) : undefined,
  };
  // Note: saveState() serializes camelCase → snake_case for JSON.
  // Called by pipeline controller after concurrent phases complete
  // to avoid race conditions when multiple phases run in parallel.

  return { skipped, docsPromise, reportPromise };
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

const verifiers: Record<string, Verifier> = {
  files: {
    name: "files-exist",
    check: async () => {
      const expected = getExpectedFiles(phase);
      const missing = expected.filter(f => !fs.existsSync(f));
      return { passed: missing.length === 0, details: `Missing: ${missing}` };
    }
  },
  tests: {
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
  typecheck: {
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
  lint: {
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
  testCoverage: {
    name: "test-coverage",
    check: async () => {
      // See test-coverage verifier section below for full implementation
      const newFiles = getFilesAddedInPhase(phase);
      const untestedFiles = findUntestedSourceFiles(newFiles);
      return { passed: untestedFiles.length === 0, details: `Untested: ${untestedFiles}` };
    }
  },
  observability: {
    name: "observability",
    check: async () => {
      // See observability enforcement section below for details
      const health = await fetch("http://localhost:3000/health").then(r => r.ok);
      return { passed: health, details: health ? "Health endpoint OK" : "Health endpoint missing" };
    }
  },
  docker: {
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
};
```

### 6. State Manager

Persists orchestrator state to `forge-state.json`. Tracks waves, skipped items, service needs, convergence history, and UAT results.

**Naming convention:** JSON uses `snake_case`. TypeScript runtime maps to `camelCase` via a serialization layer (`state.servicesNeeded` ↔ `services_needed` in JSON).

**Config access:** Throughout code examples, `config` refers to the loaded `forge.config.json` (via `loadConfig()`), passed as a separate parameter or module-level variable — it is NOT part of the state object. `state` is `forge-state.json`. Both use `snake_case` in JSON; TypeScript maps to `camelCase` via serialization layer.

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
      "mocked_service_names": ["stripe"],
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
  "mock_registry": {
    "stripe": {
      "interface": "src/services/stripe.ts",
      "mock": "src/services/stripe.mock.ts",
      "real": "src/services/stripe.real.ts",
      "factory": "src/services/stripe.factory.ts",
      "test_fixtures": ["test/fixtures/stripe-webhook.json"],
      "env_vars": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    }
  },
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
  "credentials": {},
  "human_guidance": {},
  "spec_compliance": {
    "total_requirements": 16,
    "verified": 14,
    "gap_history": [16, 5, 2, 0],
    "rounds_completed": 3
  },
  "remaining_gaps": [],
  "uat_results": {
    "status": "passed",
    "workflows_tested": 8,
    "workflows_passed": 8,
    "workflows_failed": 0
  },
  "total_budget_used": 18.77
}
```

**Key fields:**
- `mock_registry` — detailed file-level mock tracking (global). `mocked_service_names` on phases is just a string[] shorthand.
- `credentials` — populated by `forge resume --env .env.production`. Maps env var names to values.
- `human_guidance` — populated by `forge resume --guidance guidance.md`. Maps skipped item IDs to user's guidance text.
- `remaining_gaps` — populated when spec compliance loop stops converging. Contains the unresolved requirement gaps.

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

### 9. Step Runner

The core execution primitive. Every `runStep()` call wraps a single `query()` invocation with budget enforcement, error handling, and verification:

```typescript
async function runStep(name: string, opts: StepOptions): Promise<StepResult> {
  // Budget hard-stop: check BEFORE starting
  if (state.totalBudgetUsed >= config.maxBudgetTotal) {
    throw new BudgetExceededError(state.totalBudgetUsed);
  }

  try {
    for await (const message of query({
      prompt: opts.prompt,
      options: {
        permissionMode: "bypassPermissions",
        maxBudgetUsd: config.maxBudgetPerStep,
        maxTurns: config.maxTurnsPerStep,
        model: config.model,
      }
    })) {
      // Extract structured output, track cost
    }
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      // Per-step budget hit — SDK stopped the agent mid-work.
      // Treat as partial completion, run verification to see what got done.
      // Don't retry — the work may be partially complete.
    } else {
      // Other SDK errors (network, auth, OOM): log + return failed result
      // Do NOT retry SDK errors — they're infrastructure, not logic
      return { verified: false, error: error.message, sdkError: true };
    }
  }

  // Update cumulative budget
  state.totalBudgetUsed += stepCost;
  saveState(state);

  // Run verification
  const verified = await opts.verify();
  return { verified, cost: stepCost };
}
```

`runStepWithCascade` wraps `runStep` with the failure cascade (retry 3x → skip → stop). Used for execution steps where failure is recoverable.

### 10. Cost Controller

- Per-step budget: `maxBudgetUsd` on each `query()` call
- Total project budget: hard stop checked before every step — never exceeded
- Per-phase budget: sum of steps within a phase
- Per-wave budget: sum of phases within a wave
- Log cost per step for full visibility

### 11. Parallelism

Forge runs work in parallel at three levels to maximize speed and minimize cost:

#### Level 1: Verification (Always Parallel)

All verification checks run concurrently — they're independent:

```typescript
// Don't run sequentially — run all at once
const results = await Promise.all([
  verifiers.files.check(),
  verifiers.tests.check(),       // unit tests
  verifiers.typecheck.check(),
  verifiers.lint.check(),
  verifiers.testCoverage.check(),
  verifiers.observability.check(),
]);
// Docker smoke test runs after others pass (needs clean state)
if (results.every(r => r.passed)) {
  await verifiers.docker.check();
}
```

#### Level 2: Within a Phase (Subagents)

The Agent SDK's `agents` option lets a single `query()` call spawn parallel subagents. Forge uses this when a phase's plan has independent task groups:

```typescript
// Phase plan analyzed for independent task groups
const taskGroups = analyzeDependencies(plan);
// e.g., taskGroups = [
//   { name: "backend", tasks: ["API endpoints", "DB queries"] },
//   { name: "frontend", tasks: ["Components", "Pages"] },
//   { name: "tests", tasks: ["Unit tests", "Integration tests"], dependsOn: ["backend", "frontend"] }
// ]

await query({
  prompt: `Execute phase ${phase.number}. Task groups: ${JSON.stringify(taskGroups)}`,
  options: {
    agents: {
      "backend": {
        description: "Implements backend code",
        prompt: `Implement these tasks: ${taskGroups.backend.tasks}`,
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      },
      "frontend": {
        description: "Implements frontend code",
        prompt: `Implement these tasks: ${taskGroups.frontend.tasks}`,
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      },
      "tests": {
        description: "Writes all tests after implementation",
        prompt: `Write tests for: ${taskGroups.tests.tasks}`,
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      }
    }
  }
});
```

The lead agent coordinates: backend + frontend run in parallel, tests wait for both to complete.

#### Level 3: Across Phases (Concurrent query() Calls)

Some phases are independent — they don't depend on each other's output. Forge builds a dependency graph from the roadmap and runs independent phases concurrently:

```typescript
// Parse roadmap into dependency graph
const phases = parseRoadmap(".planning/ROADMAP.md");
const graph = buildDependencyGraph(phases);
// e.g., graph = {
//   1: { deps: [] },           // Core models — no deps
//   2: { deps: [1] },          // API endpoints — needs models
//   3: { deps: [1] },          // Auth system — needs models
//   4: { deps: [2, 3] },       // Frontend — needs API + auth
//   5: { deps: [1] },          // Background jobs — needs models
// }
// Phases 2, 3, 5 can run in parallel (all only depend on 1)

// Execute in waves of independent phases
const executionWaves = topologicalSort(graph);
// executionWaves = [[1], [2, 3, 5], [4]]

for (const wave of executionWaves) {
  if (wave.length === 1) {
    await runPhase(wave[0], state, { mockServices: detectExternalServices(wave[0]), onBlocker: "retry-then-skip" });
  } else {
    // Run independent phases concurrently (max 3, matching pipeline controller)
    const batch = wave.slice(0, config.parallelism.maxConcurrentPhases);
    await Promise.all(
      batch.map(phase => runPhase(phase, state, { mockServices: detectExternalServices(phase), onBlocker: "retry-then-skip" }))
    );
  }
}
```

**Concurrency limits:** Max 3 concurrent phases (budget and resource control). Configurable in `forge.config.json`.

**Git conflict handling:** Concurrent phases work on different files (enforced by phase scope). If a merge conflict occurs, Forge runs a resolution agent.

#### Level 4: Documentation (Background)

Notion updates and phase report generation run in the background while the next phase starts:

```typescript
// Don't block on docs — run in background
const docsPromise = updateNotionDocs(phase, results);
const reportPromise = generatePhaseReport(phase, results);

// Start next phase immediately
await runPhase(nextPhase, state, { mockServices: [], onBlocker: "retry-then-skip" });

// Await docs before final summary
await Promise.all([docsPromise, reportPromise]);
```

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

## Testing Pyramid (Enforced on Every Project Forge Builds)

Forge enforces a three-tier testing pyramid on every project it builds. This isn't optional — every phase must produce tests at the appropriate tiers, and Forge verifies test coverage programmatically.

### How It Works

**1. During scaffolding (Wave 1),** Forge:
- Injects testing methodology into the project's `CLAUDE.md` so all GSD agents naturally write tests
- Creates `TEST_GUIDE.md` with requirement-to-test mapping
- Sets up test directories, config files, and test harness (docker-compose.test.yml)
- Detects the stack and configures idiomatic test runners

**2. In every execution prompt,** Forge includes:
```
Testing requirements:
- Every new function/method needs unit tests
- Every new endpoint/integration point needs integration tests
- Every new user workflow needs a scenario test
- Use semantic test names (TestUserCanResetPassword), NOT Gherkin
- Reference TEST_GUIDE.md for requirement-to-test mapping
```

**3. After every phase,** Forge verifies:
- New code has corresponding test files (not just "tests pass" but "tests exist for new code")
- All three tiers run: unit → integration → scenario
- Test count went UP (new code = new tests, always)

### The Three Tiers

| Tier | What It Tests | Runs | Example |
|---|---|---|---|
| **Unit** | Individual functions, pure logic, edge cases | Every phase, fast, no external deps | `TestParseConfig_EmptyFile`, `TestCalculateTotal_WithDiscount` |
| **Integration** | API endpoints, database queries, service interactions | Every phase, may need Docker harness | `TestCreateUser_DuplicateEmail`, `TestStripeWebhook_PaymentSuccess` |
| **Scenario** | Full user workflows end-to-end | Every phase, Docker harness required | `TestUserSignsUp_VerifiesEmail_CreatesFirstProject` |

### Test Harness

For integration and scenario tests, Forge scaffolds a Docker-based test harness:

```yaml
# docker-compose.test.yml (auto-generated during scaffolding)
services:
  app:
    build: .
    environment:
      - DATABASE_URL=postgres://test:test@db:5432/testdb
  db:
    image: postgres:16
  redis:
    image: redis:7
  test:
    build: .
    command: sh -c "npm run test:integration && npm run test:e2e"
    depends_on: [app, db, redis]
```

### Test Verification (Code, Not Agent Self-Report)

```typescript
// Forge verifies test coverage programmatically
const testCoverageVerifier: Verifier = {
  name: "test-coverage",
  check: async () => {
    // Check that new source files have corresponding test files
    const newFiles = getFilesAddedInPhase(phase);
    const sourceFiles = newFiles.filter(f => isSourceFile(f));
    const testFiles = newFiles.filter(f => isTestFile(f));

    const untestedFiles = sourceFiles.filter(src => {
      const expectedTest = toTestPath(src); // src/auth.ts → test/auth.test.ts
      return !testFiles.includes(expectedTest) && !fs.existsSync(expectedTest);
    });

    return {
      passed: untestedFiles.length === 0,
      details: untestedFiles.length > 0
        ? `Missing tests for: ${untestedFiles.join(", ")}`
        : `All ${sourceFiles.length} new files have tests`
    };
  }
};

// Run the full pyramid
const pyramidVerifier: Verifier = {
  name: "test-pyramid",
  check: async () => {
    const unit = await runAndParse(config.testing.unitCommand);
    if (!unit.passed) return { passed: false, details: `Unit: ${unit.details}` };

    // Spin up harness for integration + scenario
    execSync(`docker compose -f ${config.testing.dockerComposeFile} up -d`);
    try {
      const integration = await runAndParse(config.testing.integrationCommand);
      if (!integration.passed) return { passed: false, details: `Integration: ${integration.details}` };

      const scenario = await runAndParse(config.testing.scenarioCommand);
      if (!scenario.passed) return { passed: false, details: `Scenario: ${scenario.details}` };

      return {
        passed: true,
        details: `Unit: ${unit.count} ✓ | Integration: ${integration.count} ✓ | Scenario: ${scenario.count} ✓`
      };
    } finally {
      execSync(`docker compose -f ${config.testing.dockerComposeFile} down`);
    }
  }
};
```

### What Gets Injected Into Project CLAUDE.md

During scaffolding, Forge appends this to the project's `CLAUDE.md`:

```markdown
## Testing Requirements (Enforced by Forge)

Every feature requires tests at all applicable tiers:

1. **Unit tests** — Test individual functions, pure logic, edge cases.
   No external dependencies. Fast. Run with: `{unit_command}`

2. **Integration tests** — Test API endpoints, database operations,
   service interactions. May use Docker harness. Run with: `{integration_command}`

3. **Scenario tests** — Test complete user workflows end-to-end.
   Requires Docker harness. Run with: `{scenario_command}`

Rules:
- Every new source file needs a corresponding test file
- Use semantic function names: TestUserCanResetPassword, NOT test_1
- NOT Gherkin — plain functions with descriptive names
- See TEST_GUIDE.md for requirement-to-test mapping
- Docker harness: `docker compose -f docker-compose.test.yml up -d`
```

## Notion Documentation (Mandatory)

Forge creates and maintains structured Notion documentation for every project it builds. This isn't optional — documentation is a first-class output alongside code.

### Init: Create Page Structure

During scaffolding, Forge creates 8 mandatory child pages under a user-provided Notion parent page:

| Page | Purpose |
|---|---|
| **Architecture** | System overview, component diagram, service boundaries, data models |
| **Data Flow** | How data moves through the system — request lifecycle, event flows, state transitions |
| **API Reference** | Every endpoint: method, path, params, request/response schemas, error codes, auth |
| **Component Index** | Every module/component: purpose, dependencies, public interface, file location |
| **ADRs** | Architectural Decision Records — "we chose X over Y because Z" |
| **Deployment** | Deployment targets, environments, config, runbook, infrastructure diagram |
| **Dev Workflow** | How to set up locally, run tests, create branches, deploy |
| **Phase Reports** | Parent page for per-phase reports (auto-generated) |

All page IDs stored in `forge.config.json` under `notion.doc_pages` for targeted updates.

### Per-Phase: Update Docs + Generate Phase Report

After every phase, Forge runs a documentation agent that:

1. **Updates Architecture** if new components/services were added
2. **Updates Data Flow** if new data paths, event flows, or state transitions were introduced
3. **Updates API Reference** if new endpoints were created
4. **Updates Component Index** with new modules
5. **Updates Dev Workflow** if setup steps, test commands, or development processes changed
6. **Creates ADR** for any significant design decision made during the phase
7. **Creates Phase Report** as a child of Phase Reports:
   - Phase goals and requirements addressed
   - Test results (unit/integration/scenario counts)
   - Architecture changes (from `git diff` of non-test files)
   - New tests added (from `git diff` of test files)
   - Issues encountered and how they were resolved
   - Budget used

### Milestone Completion: Final Docs

When all phases complete, Forge publishes comprehensive final documentation:
- Architecture page updated with complete system overview
- API Reference finalized with all endpoints
- Deployment page updated with production deployment instructions
- Milestone completion report aggregating all phase reports

## Requirements Format (Structured, Numbered, Verifiable)

Every requirement gathered during `forge init` follows this format:

```markdown
## R1: User Registration

**Description:** Users can create an account with email and password.

**Acceptance Criteria:**
- Email must be valid format and unique
- Password must be ≥8 characters with 1 uppercase, 1 number
- Confirmation email sent after registration
- Account inactive until email confirmed

**Edge Cases:**
- Duplicate email → 409 Conflict with message
- Invalid email format → 400 with validation error
- Password too weak → 400 with specific requirement not met
- Email service down → account created, retry email via queue

**Performance:** Registration completes in <500ms (excluding email send)

**Security:** Password hashed with bcrypt (cost factor 12), email tokens expire in 24h

**Observability:** Log registration attempts (success/failure), metric: registrations_total
```

Each requirement has:
- **ID** (R1, R2, ...) for traceability
- **Acceptance criteria** that map directly to tests
- **Edge cases** that become integration/scenario tests
- **Performance targets** that become benchmark tests
- **Security notes** that become security tests
- **Observability** requirements that get verified

## Requirement Traceability Matrix (TEST_GUIDE.md)

Forge creates and maintains a `TEST_GUIDE.md` that maps every requirement to its tests:

```markdown
# Test Guide — Requirement Traceability

| Req ID | Requirement | Unit Tests | Integration Tests | Scenario Tests |
|--------|-------------|------------|-------------------|----------------|
| R1 | User Registration | TestHashPassword, TestValidateEmail | TestCreateUser_Success, TestCreateUser_DuplicateEmail | TestUserRegistrationFlow |
| R2 | User Login | TestVerifyPassword, TestGenerateJWT | TestLogin_Success, TestLogin_WrongPassword | TestUserLoginAndAccessDashboard |
| R3 | Password Reset | TestGenerateResetToken | TestResetPassword_ValidToken, TestResetPassword_ExpiredToken | TestUserForgotPasswordFlow |
```

This matrix is:
- **Created** during scaffolding (requirements known, tests TBD)
- **Updated** after every phase (new tests added)
- **Verified** by Forge: every requirement must have at least one test at each tier
- **Used during gap closure**: if R7 has no scenario test, that's a gap to close

## Phase-Level Context Gathering

Before planning each phase, Forge runs a context-gathering step that identifies and resolves gray areas. This mirrors GSD's `/gsd:discuss-phase` but is automated:

### Gray Area Detection

For each phase, the agent analyzes the requirements and identifies:
- UI/UX decisions not specified in requirements
- Behavior ambiguities (what happens when X and Y both occur?)
- Integration approach choices (which library? which pattern?)
- Data format decisions (JSON vs protobuf? REST vs GraphQL?)

### Decision Locking

Identified decisions are written to `.planning/phases/phase-N/CONTEXT.md`:

```markdown
# Phase 3 Context

## Decisions
- API pagination: cursor-based (not offset), max 100 items per page
- Date format: ISO 8601 UTC everywhere, convert to local in frontend only
- Error responses: RFC 7807 Problem Details format
- Auth: JWT in httpOnly cookie, not Authorization header

## Deferred Ideas
- Rate limiting per user (captured for Phase 7)
- API versioning (captured for future milestone)
```

These decisions are injected into execution prompts so agents can't diverge.

### Deferred Ideas Capture

When the agent encounters ideas that are outside the current phase scope:
- Captured in CONTEXT.md under "Deferred Ideas"
- Added to ROADMAP.md as potential future phases
- Never added to current phase scope (scope guardrail)

## Plan Verification Gates

Before executing any phase, Forge validates the plan:

### Plan Quality Checks

After GSD creates a PLAN.md, Forge runs a plan-checker that validates:

1. **Requirement coverage** — Every requirement assigned to this phase has corresponding plan tasks
2. **Test task presence** — Plan includes explicit test-writing tasks (not just "implement feature")
3. **Execution order** — Task dependencies make sense (can't test before implementing)
4. **Success criteria** — Each task has clear, verifiable success criteria
5. **No scope creep** — Plan tasks map to phase requirements, nothing extra

If the plan fails checks, Forge loops back to planning with specific feedback ("Plan missing test tasks for R5, R7. Add them."). Only after verification passes does execution proceed.

### Test Task Injection

If the plan doesn't include explicit test tasks, Forge edits the plan to add them:
- "Write unit tests for {component}" for each new component
- "Write integration tests for {endpoint}" for each new endpoint
- "Write scenario test for {workflow}" for each new user workflow

This is deterministic code editing the plan file, not a prompt hoping the agent remembers.

## Gap Closure Strategy (Root Cause Analysis)

When tests fail or verification gaps are found, Forge doesn't just retry — it diagnoses first:

### Diagnostic Step

Before retrying, Forge runs a diagnostic agent that:
1. Reads the failing test output (full error, not just pass/fail)
2. Reads the relevant source code
3. Identifies the root cause category:
   - **Wrong approach** — library/pattern doesn't work → try alternative
   - **Missing dependency** — needs something not yet built → identify what
   - **Integration mismatch** — mock doesn't match real API → fix mock or implementation
   - **Requirement ambiguity** — requirement is unclear → flag for human
   - **Environment issue** — Docker, path, permissions → fix environment

### Targeted Fix Plan

Based on diagnosis, Forge creates a specific fix plan (not "try again"):
```json
{
  "diagnosis": "TestStripeWebhook_PaymentSuccess fails because webhook signature validation uses wrong secret",
  "root_cause": "integration_mismatch",
  "fix_plan": "Update src/payments/webhook.ts to read STRIPE_WEBHOOK_SECRET from env, add to .env.example",
  "files_to_change": ["src/payments/webhook.ts", ".env.example"],
  "retest": "npm run test:integration -- --grep 'Stripe'"
}
```

Then executes ONLY the fix plan, not the entire phase again.

## Atomic Commits with Requirement Linking

Every commit Forge's agents create links back to a requirement:

```
feat(R1): implement user registration endpoint

- POST /api/auth/register with email/password validation
- bcrypt hashing, email confirmation token generation
- 409 for duplicate email, 400 for validation errors

Requirement: R1 (User Registration)
Phase: 3
```

Forge verifies commit messages include requirement IDs. This creates full traceability:
- `git log --grep="R5"` → every commit related to requirement R5
- Phase reports aggregate commits per requirement
- Spec compliance can trace from requirement → commits → tests

## External Service Mock Strategy

When Forge builds phases that need external services (before credentials are available):

### Mock Pattern

Every mocked service follows this pattern:
1. **Interface defined** — `src/services/stripe.ts` exports an interface
2. **Mock implementation** — `src/services/stripe.mock.ts` implements the interface with in-memory stubs
3. **Real implementation** — `src/services/stripe.real.ts` implements the interface with real API calls
4. **Factory** — `src/services/stripe.factory.ts` returns mock or real based on env var
5. **Tagged** — All mock files have `// FORGE:MOCK — swap for real in Wave 2` comment

### Mock Registry

Forge maintains a precise list of all mocked files in state:
```json
{
  "mock_registry": {
    "stripe": {
      "interface": "src/services/stripe.ts",
      "mock": "src/services/stripe.mock.ts",
      "real": "src/services/stripe.real.ts",
      "factory": "src/services/stripe.factory.ts",
      "test_fixtures": ["test/fixtures/stripe-webhook.json"],
      "env_vars": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
    }
  }
}
```

During Wave 2, Forge uses `mock_registry` from state to systematically swap every mock.

### Mock Verification

Forge verifies mocks match the real API shape:
- Mock and real implementations must satisfy the same TypeScript interface
- Mock responses must match real API response schemas (if available)
- `// FORGE:MOCK` tags are searchable — nothing gets missed during swap

## User Acceptance Testing (UAT) — Test Like a Real User

Before Forge returns to the user, it runs the built application and tests it **as a real user would** — not just unit/integration tests, but actually using the app. Tests pass ≠ the app works. Forge verifies both.

### How It Works

After all phases complete and the spec compliance loop passes, Forge spins up the full application and walks through every user workflow defined in REQUIREMENTS.md:

```typescript
async function runUserAcceptanceTesting(state: ForgeState) {
  // 1. Start the full application stack
  execSync("docker compose up -d");
  await waitForHealthy("http://localhost:3000/health");

  // 2. For each user workflow in REQUIREMENTS.md, test it end-to-end
  const workflows = extractUserWorkflows(requirements);

  for (const workflow of workflows) {
    const result = await runStep("uat", {
      prompt: buildUATPrompt(workflow, state),
      verify: async () => {
        // Programmatic verification — NOT agent self-report.
        // Agent writes structured JSON results to a known file path.
        // Forge code reads and validates the results independently.
        const reportPath = `.forge/uat/${workflow.id}.json`;
        if (!fs.existsSync(reportPath)) return false;
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        return report.steps_failed.length === 0;
      }
    });
    workflow.verified = result.verified;
  }

  // 3. Update state with UAT results
  state.uatResults = {
    status: workflows.every(w => w.verified) ? "passed" : "failed",
    workflows_tested: workflows.length,
    workflows_passed: workflows.filter(w => w.verified).length,
    workflows_failed: workflows.filter(w => !w.verified).length,
  };
  saveState(state);

  // 4. Tear down
  execSync("docker compose down");
}
```

### By Application Type

| App Type | How Forge Tests It | Tool |
|---|---|---|
| **Web app** | Launches in headless browser, navigates pages, fills forms, clicks buttons, checks content renders, verifies redirects | Playwright / headless Chrome via Agent SDK |
| **API** | Sends real HTTP requests, verifies response bodies/status codes, tests auth flows, checks error responses | curl / fetch via Bash |
| **CLI** | Runs commands with various inputs, checks stdout/stderr, verifies exit codes, tests help output | Bash |
| **Mobile (React Native/Flutter)** | Runs in emulator, taps through flows (v2 — complex setup) | Deferred to v2 |

### Web App UAT Example

For a web app, Forge launches a browser agent that walks through user workflows:

```typescript
// Example: Test user registration flow from REQUIREMENTS.md R1
const uatPrompt = `
  The application is running at http://localhost:3000.
  You have a headless browser available.

  Test the following user workflow:
  R1: User Registration
  1. Navigate to /register
  2. Fill in email: test-uat@example.com, password: SecurePass1
  3. Click "Sign Up"
  4. Verify: success message appears OR redirect to /verify-email
  5. Check: user exists in database (curl /api/admin/users?email=test-uat@example.com)

  Edge cases to test:
  - Submit with empty email → verify error message appears
  - Submit with weak password → verify specific error shown
  - Submit with duplicate email → verify 409 error shown to user

  Report results as JSON:
  {
    "workflow": "R1",
    "steps_passed": [...],
    "steps_failed": [...],
    "screenshots": [...],  // save screenshots of failures
    "errors": [...]
  }
`;
```

### Safety Guardrails

UAT tests against a **sandboxed environment** — never production:

| Concern | How Forge Handles It |
|---|---|
| **Payments** | Uses Stripe test mode / sandbox credentials. Never real charges. |
| **Emails** | Routes to Mailhog/Mailtrap (local SMTP capture). Never sends real emails. |
| **SMS** | Routes to log-only mock. Never sends real texts. |
| **External APIs** | Uses sandbox/test endpoints where available, mocks where not. |
| **Data** | Docker test database, wiped after each run. Never touches production data. |
| **OAuth** | Uses test OAuth apps / mock providers. Never real user accounts. |

The docker-compose.test.yml already sets up this sandboxed environment. UAT runs inside it.

### When UAT Runs

UAT is the **final gate** before Forge declares done:

```
Wave 1: Build everything → mocks
Human Checkpoint: credentials
Wave 2: Real integration
Wave 3+: Spec compliance (tests pass, traceability verified)
  ↓
UAT: Actually use the app as a user would    ← NEW
  ↓
  If UAT fails: gap closure → retry UAT
  If UAT passes: DONE — return to user
```

### UAT Results in Final Report

```
═══════════════════════════════════════════════
  FORGE — Build Complete
═══════════════════════════════════════════════

  All 16 requirements verified ✓
  Test pyramid: 45 unit ✓ | 18 integration ✓ | 8 scenario ✓

  User Acceptance Testing:
  ┌────────────────────────────────────────────┐
  │ R1: User Registration         ✓ all steps │
  │ R2: User Login                ✓ all steps │
  │ R3: Password Reset            ✓ all steps │
  │ R4: Dashboard                 ✓ all steps │
  │ R5: Payment (Stripe sandbox)  ✓ all steps │
  │ R7: WebSocket updates         ✓ all steps │
  └────────────────────────────────────────────┘

  Budget: $47.23 / $200.00
  Documentation: Notion pages up to date
  Deployment: Dockerfile verified, CI passing
═══════════════════════════════════════════════
```

## Observability Enforcement

Forge enforces observability requirements on every project:

### What Gets Verified

| Check | How |
|---|---|
| Health endpoint exists | `curl /health` returns 200 with status |
| Structured logging | Log output is JSON (parse a sample) |
| Error logging | Error paths include log statements (grep source) |
| Metrics endpoint | `/metrics` returns Prometheus format (if configured) |
| Request logging | HTTP middleware logs method, path, status, duration |

### Per-Requirement Observability

Each requirement's observability notes (from REQUIREMENTS.md) are verified:
- "Log registration attempts" → grep for log statement in registration handler
- "metric: registrations_total" → check metrics endpoint includes this counter

## Deployment Strategy

During requirements gathering, Forge asks about deployment and stores the strategy:

```json
{
  "deployment": {
    "target": "vercel",
    "environments": ["development", "staging", "production"],
    "env_vars": {
      "shared": ["DATABASE_URL", "REDIS_URL"],
      "production_only": ["STRIPE_SECRET_KEY", "SENTRY_DSN"]
    },
    "infrastructure": {
      "database": "postgres (Supabase)",
      "cache": "redis (Upstash)",
      "storage": "s3 (AWS)"
    }
  }
}
```

Forge verifies:
- Dockerfile builds and runs
- docker-compose.yml matches docker-compose.test.yml services
- Environment variables are consistent across all configs
- `.env.example` lists all required vars
- Deployment config (vercel.json, fly.toml, etc.) exists and is valid

## GitHub Flow (Branch Protection + Phase Branching)

During scaffolding, Forge sets up GitHub Flow:

1. **Branch protection on main** — CI required to pass, no direct pushes
2. **Phase branching** — each phase executes on `phase-N` branch, merged to main after verification
3. **Atomic merges** — each phase merge is a single merge commit with phase summary

```typescript
// Scaffolding step sets up branch protection via GitHub CLI
await execSync(`gh api repos/${owner}/${repo}/branches/main/protection -X PUT -f 'required_status_checks={"strict":true,"contexts":["ci"]}' -f 'enforce_admins=false' -f 'required_pull_request_reviews=null' -f 'restrictions=null'`);

// Each phase runs on its own branch
await execSync(`git checkout -b phase-${phase.number}`);
// ... execute phase ...
// After verification passes:
await execSync(`git checkout main && git merge --no-ff phase-${phase.number}`);
```

This means:
- `main` is always in a working state
- Each phase's work is isolated until verified
- If a phase fails completely, main is unaffected
- Git history shows clear phase boundaries

## Phase State Machine (File-Based Checkpoints)

In addition to `forge-state.json`, each phase creates file-based checkpoints that survive crashes:

```
.planning/phases/phase-3/
├── CONTEXT.md      # ✓ Gray areas resolved, decisions locked
├── PLAN.md         # ✓ Plan verified by plan-checker
├── execution/      # ✓ In progress or complete
├── VERIFICATION.md # ✓ GSD verify-work output
├── PHASE_REPORT.md # ✓ Test results, changes, decisions
└── GAPS.md         # Gap closure diagnosis and fix plans (if any)
```

If Forge crashes mid-phase, it reads these files to determine exactly where to resume:
- CONTEXT.md exists → skip context gathering
- PLAN.md exists → skip planning
- execution/ has work → resume execution
- VERIFICATION.md exists → skip to gap closure or next phase

## Config File (`forge.config.json`)

```json
{
  "model": "claude-opus-4-6",
  "max_budget_total": 200.00,
  "max_budget_per_step": 15.00,
  "max_retries": 3,
  "max_compliance_rounds": 5,
  "max_turns_per_step": 200,
  "testing": {
    "stack": "node",
    "unit_command": "npm test -- --json",
    "integration_command": "npm run test:integration -- --json",
    "scenario_command": "npm run test:e2e",
    "docker_compose_file": "docker-compose.test.yml"
  },
  "verification": {
    "typecheck": true,
    "lint": true,
    "docker_smoke": true,
    "test_coverage_check": true,
    "observability_check": true
  },
  "notion": {
    "parent_page_id": "...",
    "doc_pages": {
      "architecture": "page-id",
      "data_flow": "page-id",
      "api_reference": "page-id",
      "component_index": "page-id",
      "adrs": "page-id",
      "deployment": "page-id",
      "dev_workflow": "page-id",
      "phase_reports": "page-id"
    }
  },
  "parallelism": {
    "max_concurrent_phases": 3,
    "enable_subagents": true,
    "background_docs": true
  },
  "deployment": {
    "target": "vercel",
    "environments": ["development", "staging", "production"]
  },
  "notifications": {
    "on_human_needed": "stdout",
    "on_phase_complete": "stdout",
    "on_failure": "stdout"
  }
}
```

**Note:** Testing commands are auto-configured during `forge init` based on detected stack. The example above shows Node.js. For Go: `go test ./... -json`, Python: `pytest --json-report`, Rust: `cargo test -- --format json`, etc.

## Workflow

### `forge init`

1. **Interactive requirements gathering** — deep, thorough conversation across all topics:
   - Core: functionality, user workflows, personas, edge cases
   - Data: model, lifecycle, state management
   - Security & Compliance: auth, SOC 2, HIPAA, GDPR, PCI DSS, WCAG
   - Integrations: third-party services, notifications, payments
   - Quality: performance targets, error handling, offline resilience, validation
   - Infrastructure: deployment, observability, CI/CD, environments
   - UX: design patterns, accessibility, i18n
   - Business: launch scope (MVP vs full), success metrics, acceptance criteria
   - Every requirement gets an ID (R1, R2, ...) and structured format
2. Writes `REQUIREMENTS.md` with structured, numbered requirements (see Requirements Format section)
3. Runs GSD new-project via `query()` (research, roadmap creation)
4. Detects stack, configures testing commands
5. Asks for Notion parent page ID → creates 8 mandatory doc pages (populated after research)
6. Scaffolds test infrastructure: directories, docker-compose.test.yml, TEST_GUIDE.md
7. Injects testing methodology into project CLAUDE.md
8. Identifies external services → creates service manifest in state
9. Writes `forge.config.json` and `forge-state.json`
10. Displays summary — user can now walk away

### `forge run`

The main command. Implements the full wave model:

**Wave 1** — Build everything possible:
1. Reads state — find current wave and position
2. If project not initialized: run GSD new-project
3. If not scaffolded: scaffold CI/CD, Docker, observability
4. For each phase:
   a. **Context gathering** — identify gray areas, lock decisions in CONTEXT.md, capture deferred ideas
   b. **Plan** — GSD plan-phase, then verify plan (requirement coverage, test tasks, success criteria)
   c. **Inject test tasks** — if plan missing test tasks, edit plan to add them
   d. **Execute** — GSD execute-phase (with mock instructions for external services)
   e. **Verify** — programmatic verification (tests, typecheck, lint, test coverage, observability)
   f. **Gap closure** — if verification fails: diagnose root cause → create fix plan → execute fix → retest
   g. **Update docs** — update Notion pages (Architecture, API Ref, Components, ADRs), create Phase Report
   h. **Update TEST_GUIDE.md** — add new test mappings for requirements addressed
   i. On unexpected blockers → retry (3x different approaches) → skip and flag → continue
5. Result: codebase ~95% complete, docs current, all automatable tests passing

**Human Checkpoint** — ONE interruption (if needed):
6. Present batched report: services needed + skipped items + deferred ideas
7. Wait for `forge resume`

**Wave 2** — Real integration:
8. Swap mocks for real implementations using mock registry (systematic, nothing missed)
9. Run integration tests against real APIs
10. Address skipped items with user guidance
11. Update Notion docs with real service details

**Wave 3+** — Spec compliance loop:
12. Verify every requirement in REQUIREMENTS.md against TEST_GUIDE.md traceability matrix
13. Check: every requirement has unit + integration + scenario test
14. Run full test pyramid (unit → Docker harness up → integration → scenario → harness down)
15. Fix gaps with root cause diagnosis → targeted fix plan
16. Loop until converging (each round fewer gaps)

**UAT** — Test like a real user (final gate):
17. Spin up full application stack (Docker)
18. Walk through every user workflow: browser for web apps, curl for APIs, bash for CLIs
19. Verify the app actually works as a user would experience it (not just tests pass)
20. Safety: sandbox credentials, local SMTP capture, test database — never production
21. If UAT fails: gap closure → retry UAT
22. If UAT passes: done

**Finish:**
23. Run `gsd:audit-milestone` to verify milestone achieved its intent
24. If audit finds gaps: create gap phases and execute them
25. Run `gsd:complete-milestone` (archive, git tag)
26. Publish final Notion documentation (Architecture, API, Deployment finalized)
27. Exit when all requirements verified + UAT passed OR not converging (report to user)

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

```bash
# Provide credentials via env file
forge resume --env .env.production

# Provide guidance for skipped items via markdown file
forge resume --env .env.production --guidance guidance.md

# guidance.md format:
# ## R7: WebSocket real-time updates
# Use SSE (Server-Sent Events) instead of WebSocket. Simpler, no CORS issues.
#
# ## R12: PDF export
# Use @react-pdf/renderer instead of puppeteer. Client-side generation is fine.
```

Continue from human checkpoint (also used for crash recovery — reads file-based phase checkpoints):
1. Reads `forge-state.json` + file-based checkpoints (CONTEXT.md, PLAN.md, etc.) to determine resume point
2. Reads `.env.production` (or provided env file) → populates `state.credentials`
3. Reads `guidance.md` (if provided) → populates `state.humanGuidance` keyed by requirement ID
4. Enters Wave 2 (swap mocks using `mock_registry`, apply guidance to skipped items)
5. Updates Notion docs with real service details
6. Wave 3+ (spec compliance loop)
7. UAT (final gate — test like a real user)
8. Return to user only when everything passes

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
- [ ] `forge init` gathers deep requirements with structured format (R1, R2, ... with acceptance criteria)
- [ ] `forge init` creates 8 Notion documentation pages + TEST_GUIDE.md + CLAUDE.md testing injection
- [ ] `forge run` implements full wave model (build → checkpoint → integrate → verify)
- [ ] Each step gets a fresh context via separate `query()` call
- [ ] GSD skills called directly (no AX layer)
- [ ] Phase-level context gathering: gray area detection, decision locking in CONTEXT.md, deferred ideas
- [ ] Plan verification gates: requirement coverage, test task presence, execution order, success criteria
- [ ] Test task injection: plans without test tasks get them added automatically
- [ ] Testing pyramid enforced: unit → integration → scenario, verified per phase
- [ ] TEST_GUIDE.md traceability matrix: every requirement mapped to tests at all tiers
- [ ] Test coverage check: new code must have corresponding test files
- [ ] Programmatic verification after every step (not agent self-report)
- [ ] Gap closure with root cause diagnosis → targeted fix plan → execute fix (not "retry")
- [ ] External services built with mocks (interface + mock + real + factory pattern), swapped in Wave 2
- [ ] Mock registry: precise tracking of all mocked files for systematic swap
- [ ] ONE human checkpoint with batched report (services + skipped items + deferred ideas)
- [ ] Spec compliance loop: verify every requirement, check traceability, fix gaps, converge
- [ ] Exit condition is "all requirements verified with passing tests" not "all phases ran"
- [ ] Atomic commits with requirement IDs (feat(R1): ...) for full traceability
- [ ] Notion docs updated per phase: Architecture, Data Flow, API Ref, Components, Dev Workflow, ADRs, Phase Reports
- [ ] Phase Reports: goals, test results, architecture changes, git diffs, budget
- [ ] Observability enforcement: health endpoint, structured logging, error logging verified
- [ ] Deployment strategy verified: Dockerfile builds, env vars consistent, deploy config valid
- [ ] File-based phase checkpoints (CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md)
- [ ] State persists across interruptions, waves, and crashes
- [ ] Cost tracked per step, phase, wave, and total
- [ ] `forge resume` picks up exactly where it left off with new credentials/guidance
- [ ] `forge status` shows human-readable progress: wave, phase table, spec compliance, budget
- [ ] User Acceptance Testing: app spun up and tested as a real user would (browser/curl/bash by app type)
- [ ] UAT safety guardrails: sandbox credentials, local SMTP, test DB — never production
- [ ] UAT as final gate: only return to user after UAT passes (or not converging)
- [ ] GitHub Flow: branch protection on main, each phase on its own branch, merged after verification
- [ ] Parallelism: independent phases run concurrently, verification checks run in parallel

### v2
- [ ] Agent Teams for cross-repo / multi-project parallelism
- [ ] Holdout evaluation (separate AI reviews against requirements, never sees implementation)
- [ ] Webhook/Slack notifications for human checkpoint
- [ ] Live dashboard showing wave progress, costs, spec compliance, Notion doc freshness
- [ ] Multiple concurrent projects
- [ ] Deployment automation (push to production after spec compliance)
- [ ] Learning across projects (what approaches work for what problem types)
- [ ] Cost-per-requirement analysis
- [ ] Post-phase retrospective and pattern analysis

## File Structure

```
forge/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point (commander.js)
│   ├── pipeline.ts           # Wave-based pipeline controller
│   ├── requirements.ts       # Interactive requirements gatherer (structured R1, R2 format)
│   ├── phase-runner.ts       # Runs a single phase (context → plan → verify plan → execute → verify → docs)
│   ├── step-runner.ts        # Runs a single query() step with verification
│   ├── context-gatherer.ts   # Gray area detection, decision locking, deferred ideas
│   ├── plan-checker.ts       # Plan verification gates (coverage, test tasks, order, criteria)
│   ├── spec-compliance.ts    # Spec compliance loop (verify → diagnose → fix → converge)
│   ├── gap-closure.ts        # Root cause diagnosis → targeted fix plan → execute
│   ├── service-detector.ts   # Detects external service needs from phase descriptions
│   ├── mock-manager.ts       # Mock registry, interface/mock/real/factory pattern
│   ├── notion.ts             # Notion page creation, updates, phase reports
│   ├── traceability.ts       # TEST_GUIDE.md management, requirement-to-test mapping
│   ├── verifiers/
│   │   ├── index.ts          # Verifier registry
│   │   ├── files.ts          # File existence checks
│   │   ├── tests.ts          # Test runner + JSON output parser
│   │   ├── test-coverage.ts  # New code has corresponding test files
│   │   ├── typecheck.ts      # TypeScript/language type checking
│   │   ├── lint.ts           # Linter checks
│   │   ├── docker.ts         # Docker-based smoke/integration tests
│   │   ├── observability.ts  # Health endpoint, logging, metrics verification
│   │   └── deployment.ts     # Dockerfile, env vars, deploy config verification
│   ├── uat.ts                # User acceptance testing orchestration (browser/curl/bash by app type)
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
