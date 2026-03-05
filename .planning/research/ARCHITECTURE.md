# Architecture Patterns

**Domain:** Autonomous AI software development orchestrator (code-based, not prompt-chaining)
**Researched:** 2026-03-05

## Recommended Architecture

Forge is a **code-based pipeline orchestrator** that wraps the Claude Agent SDK's `query()` function with deterministic control flow, programmatic verification, and durable state. The architecture follows the **orchestrator-worker pattern** with a single long-lived Node.js process (the orchestrator) dispatching focused work to ephemeral Agent SDK sessions (the workers).

```
                    forge CLI (long-lived Node.js process)
                              |
            +-----------------+-----------------+
            |                 |                 |
     Config Loader     State Manager     Cost Controller
            |                 |                 |
            +---------+-------+---------+-------+
                      |                 |
              Pipeline Controller       |
              (Wave Model FSM)          |
                      |                 |
              Phase Runner              |
              (per-phase lifecycle)     |
                      |                 |
              Step Runner -------- Verifier Registry
              (query() wrapper)         |
                      |           +-----+-----+
              Agent SDK           |     |     |
              query()          files  tests  typecheck
              (ephemeral)       lint  coverage docker
                                observability  deployment
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **CLI Entry Point** (`index.ts`) | Parse commands (init, run, phase, status, resume), bootstrap config/state, dispatch to Pipeline Controller or standalone Phase Runner | Config, State, Pipeline Controller, Phase Runner |
| **Pipeline Controller** (`pipeline.ts`) | Implement wave model FSM (Wave 1 -> Checkpoint -> Wave 2 -> Wave 3+ -> UAT -> Finish), orchestrate phase execution order via dependency graph, manage human checkpoints | Phase Runner, State Manager, Dependency Graph, Human Checkpoint |
| **Phase Runner** (`phase-runner.ts`) | Execute single phase lifecycle: context -> plan -> verify-plan -> execute -> test -> gap-closure -> docs. Handle retry-then-skip cascade per phase | Step Runner, Plan Checker, Verifier Registry, Gap Closure, Traceability, State Manager |
| **Step Runner** (`step-runner.ts`) | Core primitive. Wrap single `query()` call with budget check, error handling, cost tracking, and post-step verification callback. Also `runStepWithCascade` variant for retry-then-skip | Agent SDK `query()`, Cost Controller, State Manager, Verifier callbacks |
| **State Manager** (`state.ts`) | Persist `forge-state.json` with camelCase<->snake_case serialization. Track waves, phases, services, skipped items, compliance history, UAT results. Support crash recovery via file-based checkpoints | File system (`forge-state.json`, `.planning/phases/`) |
| **Config Loader** (`config.ts`) | Load and validate `forge.config.json`. Provide typed access to budget limits, testing commands, verification toggles, parallelism settings, Notion config | File system (`forge.config.json`) |
| **Cost Controller** (`cost.ts`) | Enforce per-step budget via `maxBudgetUsd` on query(), track cumulative cost per phase/wave/total, hard-stop before any step if total budget exceeded | State Manager, Step Runner |
| **Verifier Registry** (`verifiers/index.ts`) | Registry of programmatic verification checks. Run checks in parallel (files, tests, typecheck, lint, coverage, observability). Docker smoke test runs sequentially after others pass | Individual verifier modules, child processes (npm test, tsc, eslint, docker) |
| **Plan Checker** (`plan-checker.ts`) | Validate phase plans for requirement coverage, test task presence, execution order, success criteria. Inject missing test tasks deterministically | File system (PLAN.md), Requirements parser |
| **Gap Closure** (`gap-closure.ts`) | Diagnose test failures via root cause categorization (wrong approach, missing dependency, integration mismatch, requirement ambiguity, environment issue). Create targeted fix plans instead of blind retry | Step Runner, Verifier Registry |
| **Requirements Parser** (`requirements.ts`) | Parse REQUIREMENTS.md into structured requirement objects (R1, R2, ...) with acceptance criteria, edge cases, performance targets. Also handles interactive gathering during `forge init` | File system (REQUIREMENTS.md), Agent SDK (for interactive gathering) |
| **Dependency Graph** (`dependency-graph.ts`) | Parse ROADMAP.md, build DAG of phase dependencies, topological sort into execution waves. Identify which phases can run concurrently | File system (ROADMAP.md) |
| **Mock Manager** (`mock-manager.ts`) | Track interface/mock/real/factory file quadruplets in mock registry. Systematic mock-to-real swap during Wave 2 | State Manager (mock_registry), File system |
| **Spec Compliance** (`spec-compliance.ts`) | Loop: verify every requirement -> count gaps -> check convergence (gaps decreasing each round?) -> fix gaps -> repeat. Stop if not converging or all verified | Verifier Registry, Gap Closure, State Manager |
| **UAT Runner** (`uat.ts`) | Spin up full application stack, walk through user workflows by app type (browser for web, curl for API, bash for CLI). Verify structured JSON reports written by agent | Step Runner, Docker, State Manager |
| **Human Checkpoint** (`checkpoint.ts`) | Batch all human needs (services, skipped items, deferred ideas) into single report. Present formatted output. Parse `forge resume` inputs (env file, guidance markdown) | State Manager |
| **Prompt Builders** (`prompts.ts`) | Construct focused prompts for each step type (context, plan, execute, gap-closure, UAT, etc.). Include relevant context without bloating | Requirements Parser, State Manager, Phase files |
| **Traceability** (`traceability.ts`) | Manage TEST_GUIDE.md requirement-to-test mapping. Update after each phase. Verify every requirement has tests at each tier | File system (TEST_GUIDE.md), Requirements Parser |
| **Notion Docs** (`notion.ts`) | Create/update 8 mandatory Notion pages. Run in background (non-blocking). Source of truth is local files; Notion is the published version | MCP Server (Notion), State Manager |

### Data Flow

**Primary data flow (Wave 1 execution):**

```
1. CLI parses command -> loads Config + State
2. Pipeline Controller reads State, determines current wave position
3. Pipeline Controller parses ROADMAP.md into dependency graph
4. Topological sort produces execution waves: [[1], [2, 3, 5], [4]]
5. For each execution wave:
   a. Phase Runner receives phase + state + mock instructions
   b. Phase Runner checks file-based checkpoints (CONTEXT.md, PLAN.md exist?)
   c. Step Runner builds prompt from context, calls query()
   d. Agent SDK session executes (fresh context, ephemeral)
   e. Step Runner extracts structured output from SDKResultMessage
   f. Step Runner updates cumulative cost in State
   g. Verifier Registry runs programmatic checks (parallel)
   h. If verification fails: Gap Closure diagnoses, Step Runner retries with fix plan
   i. State Manager persists updated phase status
6. After all phases: Pipeline Controller collects services_needed + skipped_items
7. Human Checkpoint batches and presents report
8. Pipeline Controller transitions to Wave 2 state
```

**Data flow between components (critical paths):**

```
Config ------> Step Runner (budget limits, turn limits, model)
State -------> Pipeline Controller (wave position, phase statuses)
State -------> Step Runner (cumulative budget check)
State -------> Human Checkpoint (services needed, skipped items)
State <------- Step Runner (cost updates, step results)
State <------- Phase Runner (phase status, test results)

REQUIREMENTS.md ----> Plan Checker (coverage validation)
REQUIREMENTS.md ----> Spec Compliance (per-requirement verification)
REQUIREMENTS.md ----> Prompt Builders (context for agent)

ROADMAP.md ----> Dependency Graph ----> Pipeline Controller (execution order)

query() ----> SDKMessage stream ----> Step Runner (cost extraction, result parsing)
query() ----> SDKResultMessage.total_cost_usd ----> Cost Controller

Verifier outputs ----> Gap Closure (test failures, type errors)
Gap Closure ----> Step Runner (targeted fix prompt)
```

## Patterns to Follow

### Pattern 1: Fresh Context Per Step

**What:** Every `query()` call creates a new Agent SDK session with no memory of previous sessions. Context is explicitly injected via the prompt, not accumulated.

**When:** Always. This is the foundational pattern that prevents context degradation.

**Why:** The Agent SDK documentation confirms: "Every query() call without a resume parameter starts a fresh session with no memory of anything before it." This is a feature, not a limitation. Stale context causes the agent to hallucinate about what it already did, skip steps it thinks it completed, or reference files that no longer exist. Fresh context per step means the orchestrator code controls exactly what the agent knows.

**Confidence:** HIGH (verified via Agent SDK official docs)

**Example:**
```typescript
// GOOD: Fresh context, explicitly constructed
const result = await runStep("execute-phase-3", {
  prompt: `
    You are executing phase 3 of project Foo.

    Phase plan: ${fs.readFileSync(planPath, "utf8")}
    Project structure: ${getProjectTree()}
    Requirements addressed: ${phaseRequirements.join(", ")}

    Mock instructions: Build Stripe integration using mock.
    Create: interface (stripe.ts), mock (stripe.mock.ts),
    real stub (stripe.real.ts), factory (stripe.factory.ts)

    Run /gsd:execute-phase 3
  `,
  verify: async () => { /* programmatic checks */ }
});

// BAD: Resuming a session to "continue" previous work
// This accumulates context and degrades quality
```

**Implication for build:** Step Runner must be built first and correctly. Every other component depends on it producing reliable, isolated query() calls.

### Pattern 2: Programmatic Verification (Code, Not Self-Report)

**What:** After every agent step, the orchestrator runs deterministic code checks to verify the work was actually done. Never trust the agent's claim that "all tests pass" or "file created."

**When:** After every `runStep()` call. Verification is not optional.

**Why:** This is the key insight from StrongDM's Attractor. Agents will self-report success even when work is incomplete. StrongDM found agents writing `return true` to pass tests. Programmatic verification eliminates this class of failure entirely.

**Confidence:** HIGH (StrongDM's published Attractor spec, multiple sources confirm pattern)

**Example:**
```typescript
// Verification is a callback, not an agent judgment
const verifyFilesExist: VerifyFn = async () => {
  const expected = ["src/auth/login.ts", "src/auth/register.ts", "test/auth/login.test.ts"];
  const missing = expected.filter(f => !fs.existsSync(path.resolve(projectDir, f)));
  return missing.length === 0;
};

// Verification runs deterministic code
const verifyTestsPass: VerifyFn = async () => {
  const { stdout } = await execAsync("npm test -- --json");
  const result = JSON.parse(stdout);
  return result.numFailedTests === 0;
};
```

### Pattern 3: State Machine with File-Based Checkpoints

**What:** The pipeline and phase runners operate as explicit state machines. State transitions are persisted to both `forge-state.json` (runtime state) and file-based checkpoints (`.planning/phases/phase-N/CONTEXT.md`, `PLAN.md`, etc.).

**When:** At every state transition boundary. Before and after every step.

**Why:** Forge runs long-lived processes (potentially hours). Crashes, network failures, and budget exhaustion are expected. The Temporal pattern of "durable execution" applies here: every side effect should be persisted so the process can resume from where it left off. File-based checkpoints are the simplest form of this -- no external database needed.

**Confidence:** HIGH (Temporal durable execution patterns widely documented, file-based checkpointing is standard practice)

**State machine for Pipeline Controller:**
```
                    INIT
                      |
               [project setup]
                      |
                  SCAFFOLDING
                      |
               [CI/CD, Docker]
                      |
                   WAVE_1
                      |
           [execute phases with mocks]
                      |
            HUMAN_CHECKPOINT (if needed)
                      |
               [user provides creds]
                      |
                   WAVE_2
                      |
           [swap mocks, fix skipped]
                      |
                  WAVE_3_PLUS
                      |
           [spec compliance loop]
                      |
                    UAT
                      |
           [test like real user]
                      |
                  FINISHING
                      |
           [audit, complete milestone]
                      |
                  COMPLETED
```

**State machine for Phase Runner:**
```
    CONTEXT_GATHERING
          |
      PLANNING
          |
    PLAN_VERIFICATION
          |
      EXECUTING
          |
       TESTING
          |
    GAP_CLOSURE (loop with max retries)
          |
    VERIFYING_WORK
          |
    UPDATING_DOCS (background)
          |
      COMPLETED / PARTIAL / SKIPPED
```

**Example:**
```typescript
// Check file-based checkpoints before running each substep
async function runPhase(phase: Phase, state: ForgeState): Promise<PhaseResult> {
  const phaseDir = `.planning/phases/phase-${phase.number}`;

  // Resume from where we left off
  if (!fs.existsSync(`${phaseDir}/CONTEXT.md`)) {
    await runStep("context", { prompt: buildContextPrompt(phase), verify: ... });
  }
  if (!fs.existsSync(`${phaseDir}/PLAN.md`)) {
    await runStep("plan", { prompt: buildPlanPrompt(phase), verify: ... });
  }
  // ... continue from last checkpoint
}
```

### Pattern 4: Three-Tier Failure Cascade

**What:** Every recoverable failure follows: Retry with different approach (3x) -> Skip and flag -> Stop only if nothing else can proceed.

**When:** During phase execution, gap closure, spec compliance, and UAT.

**Why:** Autonomous systems must maximize progress. A single failing step should not halt the entire pipeline when other work can proceed. This follows the DAG execution pattern of "partial success" -- complete what you can, report what you could not. Airflow, Dagster, and Temporal all implement variants of this pattern.

**Confidence:** HIGH (well-established in pipeline orchestration literature)

**Example:**
```typescript
async function runStepWithCascade(
  name: string,
  opts: StepOptions & { maxRetries?: number }
): Promise<StepResult> {
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = attempt === 1
      ? opts.prompt
      : buildRetryPrompt(opts.prompt, previousErrors, attempt);

    const result = await runStep(`${name}-attempt-${attempt}`, {
      prompt,
      verify: opts.verify,
    });

    if (result.verified) return result;
    previousErrors.push(result.error);
  }

  // All retries exhausted -- skip and flag
  return {
    verified: false,
    status: "skipped",
    attempts: previousErrors,
  };
}
```

### Pattern 5: Budget as Hard Constraint (Pre-Check, Not Post-Mortem)

**What:** Check cumulative budget BEFORE starting any step. Use SDK's `maxBudgetUsd` for per-step caps. Track cost from `SDKResultMessage.total_cost_usd`.

**When:** Before every `query()` call and after every `query()` completion.

**Why:** LLM costs are unpredictable per-step but must be bounded per-project. The Agent SDK provides `maxBudgetUsd` which will stop the agent mid-work if exceeded (emitting `SDKResultMessage` with `subtype: "error_max_budget_usd"`). The orchestrator must also enforce a total project budget independent of per-step limits, because many small steps can exceed the total.

**Confidence:** HIGH (verified in Agent SDK TypeScript reference -- `maxBudgetUsd` option and `error_max_budget_usd` result subtype are documented)

**Example:**
```typescript
async function runStep(name: string, opts: StepOptions): Promise<StepResult> {
  // Hard stop: check BEFORE starting
  if (state.totalBudgetUsed >= config.maxBudgetTotal) {
    throw new BudgetExceededError(state.totalBudgetUsed, config.maxBudgetTotal);
  }

  let totalCost = 0;
  let resultMessage: SDKResultMessage | undefined;

  for await (const message of query({
    prompt: opts.prompt,
    options: {
      permissionMode: "bypassPermissions",
      maxBudgetUsd: config.maxBudgetPerStep,
      maxTurns: config.maxTurnsPerStep,
      model: config.model,
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
    }
  })) {
    if (message.type === "result") {
      resultMessage = message;
      totalCost = message.total_cost_usd;
    }
  }

  // Update cumulative budget
  state.totalBudgetUsed += totalCost;
  saveState(state);

  // Handle budget exhaustion (agent stopped mid-work)
  if (resultMessage?.subtype === "error_max_budget_usd") {
    // Run verification anyway -- partial work may still pass
  }

  const verified = await opts.verify();
  return { verified, cost: totalCost };
}
```

### Pattern 6: DAG-Based Phase Execution with Topological Sort

**What:** Parse the roadmap into a dependency graph, topologically sort into execution waves, and run independent phases concurrently within each wave.

**When:** During Wave 1 and Wave 2 phase execution.

**Why:** A project with 6 phases where phases 2, 3, and 5 all only depend on phase 1 should not execute sequentially. Running independent phases concurrently (up to a configurable limit) reduces total execution time significantly. This is the standard DAG execution pattern used by Airflow, Dagster, and every CI/CD system.

**Confidence:** HIGH (standard DAG execution pattern, well-documented)

**Example:**
```typescript
// Build dependency graph from roadmap
const phases = parseRoadmap(".planning/ROADMAP.md");
const graph = buildDependencyGraph(phases);

// Topological sort into execution waves
// Result: [[1], [2, 3, 5], [4, 6]]
// Wave 1: phase 1 alone (no deps)
// Wave 2: phases 2, 3, 5 in parallel (all depend only on 1)
// Wave 3: phases 4, 6 in parallel (depend on earlier phases)
const executionWaves = topologicalSort(graph);

for (const wave of executionWaves) {
  const pending = wave.filter(p => state.phases[p.number]?.status !== "completed");
  if (pending.length <= 1) {
    await runPhase(pending[0], state, opts);
  } else {
    // Concurrent execution, bounded by config
    const batch = pending.slice(0, config.parallelism.maxConcurrentPhases);
    const results = await Promise.all(batch.map(p => runPhase(p, state, opts)));
    // Merge results into state AFTER all concurrent phases complete
    for (const result of results) {
      mergePhaseResult(state, result);
    }
    saveState(state);
  }
}
```

### Pattern 7: Structured Output Extraction via SDK Result Messages

**What:** Use the Agent SDK's `SDKResultMessage` to extract structured output, cost data, and completion status. For richer structured data, instruct the agent to write JSON to known file paths and read them programmatically.

**When:** At the end of every `query()` call.

**Why:** The SDK provides `SDKResultMessage` with `result` (string), `total_cost_usd`, `num_turns`, `usage`, and `structured_output` (when using `outputFormat`). However, for complex step outputs (file lists, test results, service detections), it is more reliable to have the agent write to a known path and parse it, rather than parsing free-form text from the result string. The SDK also supports `outputFormat: { type: 'json_schema', schema: ... }` for structured outputs.

**Confidence:** HIGH (verified in Agent SDK TypeScript reference -- `SDKResultMessage` type, `outputFormat` option, and `structured_output` field are documented)

**Example:**
```typescript
// Option A: Use SDK structured output
for await (const message of query({
  prompt: "Analyze phase requirements and output analysis.",
  options: {
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          externalServices: { type: "array", items: { type: "string" } },
          grayAreas: { type: "array", items: { type: "string" } },
          dependencies: { type: "array", items: { type: "string" } },
        },
        required: ["externalServices", "grayAreas", "dependencies"]
      }
    }
  }
})) {
  if (message.type === "result" && message.subtype === "success") {
    const analysis = message.structured_output; // typed JSON
  }
}

// Option B: Agent writes to known path (more robust for complex outputs)
// Prompt includes: "Write results to .forge/step-output.json"
// After query() completes:
const output = JSON.parse(fs.readFileSync(".forge/step-output.json", "utf8"));
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Session Resumption for Multi-Step Work

**What:** Using `resume: sessionId` to continue a previous session for the next step in the pipeline.

**Why bad:** Context accumulates across turns. The agent starts referencing stale state, forgetting earlier instructions, or hallucinating about completed work. Context compaction (visible in `SDKCompactBoundaryMessage`) may discard important context. The whole point of code-based orchestration is that each step gets exactly the context it needs, no more.

**Instead:** Use fresh `query()` calls per step. Inject only the context needed for that specific step via the prompt. Let the orchestrator code be the memory, not the agent's conversation history.

### Anti-Pattern 2: Agent Self-Report as Verification

**What:** Trusting the agent's textual output ("I created the files", "all tests pass") as proof of work.

**Why bad:** Agents hallucinate completion. StrongDM documented agents writing `return true` to pass tests. Even well-intentioned agents may skip steps under context pressure. Self-report is a stochastic signal -- it might be right, but you cannot depend on it.

**Instead:** Always run programmatic verification. `fs.existsSync()`, `execSync("npm test -- --json")`, `execSync("npx tsc --noEmit")`. The verification callback on every `runStep()` is mandatory, never optional.

### Anti-Pattern 3: Monolithic Phase Execution

**What:** Sending the entire phase plan as one giant prompt and hoping the agent executes everything correctly in one session.

**Why bad:** Large prompts exceed effective context limits. The agent loses track of earlier instructions. Partial failures are unrecoverable -- you cannot tell what succeeded and what did not. Verification is all-or-nothing.

**Instead:** Break phases into substeps (context -> plan -> execute -> test -> gap-close -> docs), each with its own `query()` call and verification. This is what the Phase Runner does.

### Anti-Pattern 4: Unbounded Retry Loops

**What:** Retrying a failed step indefinitely until it passes.

**Why bad:** Some failures are not recoverable with the same approach. Infinite retries burn budget without progress. StrongDM's Attractor has a `max_retries` of 50 (generous but bounded). The spec compliance loop checks convergence (gaps must decrease each round).

**Instead:** Cap retries at 3 per step, check convergence in loops, and use the skip-and-flag pattern to preserve progress on other work.

### Anti-Pattern 5: Implicit State (In-Memory Only)

**What:** Tracking pipeline progress only in JavaScript variables without persisting to disk.

**Why bad:** A crash, OOM kill, or network timeout loses all progress. The process may have been running for hours and completed expensive LLM work. Re-running from scratch wastes significant budget.

**Instead:** Persist state after every step completion. Use both `forge-state.json` (structured runtime state) and file-based checkpoints (CONTEXT.md, PLAN.md, etc.) that survive crashes. On resume, check file-based checkpoints first, then state file.

### Anti-Pattern 6: Shared Mutable State During Concurrent Phase Execution

**What:** Multiple concurrent `runPhase()` calls modifying the same state object simultaneously.

**Why bad:** Race conditions. Two phases completing simultaneously could overwrite each other's state updates. Node.js is single-threaded for CPU but `await` points allow interleaving.

**Instead:** Collect results from concurrent phases, then merge into state sequentially AFTER all concurrent phases in a wave complete. Save state once after the merge.

## Agent SDK Integration Architecture

### SDK Configuration for Forge

Based on verified Agent SDK TypeScript reference (HIGH confidence):

```typescript
// Standard Forge query() options
const forgeQueryOptions: Options = {
  // Permission mode for autonomous execution
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,

  // System prompt: use Claude Code preset for full tool access + GSD skills
  systemPrompt: { type: "preset", preset: "claude_code" },

  // Settings: load user/project/local for CLAUDE.md and GSD skills
  settingSources: ["user", "project", "local"],

  // Budget: per-step cap enforced by SDK
  maxBudgetUsd: 15.00,

  // Turn limit: prevent runaway agents
  maxTurns: 200,

  // Model: configurable via forge.config.json
  model: "claude-opus-4-6",

  // Working directory: target project
  cwd: projectDir,

  // Tools: all Claude Code tools available
  // (default when using claude_code preset)
};
```

### Key SDK Features to Leverage

| Feature | How Forge Uses It | Confidence |
|---------|-------------------|------------|
| `query()` async generator | One call per pipeline step, fresh context | HIGH |
| `SDKResultMessage.total_cost_usd` | Per-step cost tracking | HIGH |
| `SDKResultMessage.subtype` | Detect budget exhaustion, max turns, errors | HIGH |
| `maxBudgetUsd` option | Per-step budget cap | HIGH |
| `maxTurns` option | Prevent runaway sessions | HIGH |
| `permissionMode: "bypassPermissions"` | Fully autonomous file/command operations | HIGH |
| `systemPrompt: { preset: "claude_code" }` | Full CC tools + GSD skills | HIGH |
| `settingSources` | Load CLAUDE.md, settings, GSD slash commands | HIGH |
| `agents` option (subagents) | Parallel work within a step (backend + frontend) | HIGH |
| `outputFormat` (structured output) | Type-safe JSON extraction from agent | HIGH |
| `hooks` (PreToolUse, PostToolUse, etc.) | Progress monitoring, audit logging, safety checks | HIGH |
| `resume` / `sessionId` | NOT used for multi-step (anti-pattern). Only for crash recovery within a single step | HIGH |
| `mcpServers` (Notion MCP) | Documentation page creation/updates | MEDIUM |
| `abortController` | Graceful step cancellation on budget/timeout | HIGH |

### SDK Message Processing

The Step Runner must process the `SDKMessage` stream to extract:

1. **Cost data** from `SDKResultMessage.total_cost_usd` and `SDKResultMessage.modelUsage`
2. **Completion status** from `SDKResultMessage.subtype` (success, error_max_turns, error_max_budget_usd, error_during_execution)
3. **Session ID** from `SDKSystemMessage` (init) for logging/debugging
4. **Progress events** from `SDKAssistantMessage` for optional progress reporting
5. **Permission denials** from `SDKResultMessage.permission_denials` to detect misconfigured permissions
6. **Errors** from `SDKAssistantMessage.error` (authentication_failed, rate_limit, etc.)

## Scalability Considerations

| Concern | Single Project | Multiple Phases | Future (v2) |
|---------|---------------|-----------------|-------------|
| **Concurrency** | Sequential steps | Up to 3 concurrent phases via Promise.all | Multi-project parallelism |
| **Budget** | Per-step + total caps | Per-phase accumulation | Per-project isolation |
| **State** | Single forge-state.json | File-based phase checkpoints | Per-project state files |
| **Context** | Fresh per step (~200K tokens) | Independent per phase | Cross-project context sharing |
| **Cost** | ~$50-200 per project | Scales linearly with phases | Cost-per-requirement analytics |
| **Recovery** | File-based resume | Per-phase granularity | Transaction-like rollback |

## Suggested Build Order

The dependency graph between components dictates build order. Components are ordered so that each one can be unit tested with mocks of its dependencies before the dependency is fully built.

### Layer 0: Foundation (no internal dependencies)

1. **Config Loader** (`config.ts`) -- Pure data loading, no dependencies on other components. Needed by everything.
2. **State Manager** (`state.ts`) -- Pure serialization/deserialization with camelCase<->snake_case mapping. Needed by everything.

### Layer 1: Core Primitive (depends on Layer 0)

3. **Step Runner** (`step-runner.ts`) -- The most critical component. Wraps `query()` with budget enforcement, error handling, cost tracking, and verification callback. Everything else depends on this. Build and integration-test this first against the real Agent SDK.
4. **Cost Controller** (`cost.ts`) -- Budget checking logic used by Step Runner. Can be built in parallel with Step Runner.

### Layer 2: Verification (depends on Layer 0-1)

5. **Verifier Registry** (`verifiers/index.ts`) -- Registry pattern + parallel execution. Individual verifiers (files, tests, typecheck, lint) are independent and can be built incrementally.
6. **Individual Verifiers** (`verifiers/*.ts`) -- Each verifier is a pure function: run a check, return `{ passed, details }`. Can be built and tested independently.

### Layer 3: Phase Lifecycle (depends on Layer 0-2)

7. **Requirements Parser** (`requirements.ts`) -- Parse REQUIREMENTS.md. Needed by Plan Checker and Spec Compliance.
8. **Plan Checker** (`plan-checker.ts`) -- Validate plans against requirements. Deterministic code, easy to unit test.
9. **Gap Closure** (`gap-closure.ts`) -- Root cause diagnosis + targeted fix prompts. Uses Step Runner.
10. **Phase Runner** (`phase-runner.ts`) -- Orchestrates single phase lifecycle. Uses Step Runner, Plan Checker, Verifiers, Gap Closure. The second most complex component.

### Layer 4: Pipeline Orchestration (depends on Layer 0-3)

11. **Dependency Graph** (`dependency-graph.ts`) -- Parse ROADMAP.md into DAG, topological sort. Pure algorithm, easy to unit test.
12. **Mock Manager** (`mock-manager.ts`) -- Track and swap mocks. Mostly state tracking logic.
13. **Spec Compliance** (`spec-compliance.ts`) -- Loop: verify -> diagnose -> fix -> converge. Uses Phase Runner and Verifiers.
14. **Pipeline Controller** (`pipeline.ts`) -- Wave model FSM. Uses Phase Runner, Dependency Graph, Mock Manager, Spec Compliance. The most complex component.

### Layer 5: Human Interface (depends on Layer 0-4)

15. **Human Checkpoint** (`checkpoint.ts`) -- Batch and present human needs. Parse resume inputs.
16. **CLI Entry Point** (`index.ts`) -- Wire everything together. Commander.js commands.

### Layer 6: Enhancement (depends on Layer 0-5, can be deferred)

17. **Requirements Gatherer** (interactive mode in `requirements.ts`) -- Interactive `forge init`. Uses Agent SDK but in a different mode (conversational, not pipeline).
18. **UAT Runner** (`uat.ts`) -- Final verification gate. Uses Step Runner + Docker.
19. **Traceability** (`traceability.ts`) -- TEST_GUIDE.md management. Important but not blocking.
20. **Notion Docs** (`notion.ts`) -- Background documentation. Uses MCP. Can be deferred.
21. **Prompt Builders** (`prompts.ts`) -- Template construction. Can be built incrementally alongside each feature.

### Build Order Rationale

The ordering follows a strict dependency chain: Config/State -> Step Runner -> Verifiers -> Phase Runner -> Pipeline Controller -> CLI. Each layer can be integration tested before building the next. The Step Runner is the most critical component because it is the interface between Forge's deterministic code and the stochastic Agent SDK. If the Step Runner does not work correctly, nothing else matters.

## Sources

- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- HIGH confidence, official docs
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) -- HIGH confidence, official docs
- [StrongDM Attractor Spec](https://github.com/strongdm/attractor/blob/main/attractor-spec.md) -- HIGH confidence, open source reference
- [StrongDM Software Factory (Simon Willison)](https://simonwillison.net/2026/Feb/7/software-factory/) -- MEDIUM confidence, credible reporting
- [Temporal: Beyond State Machines](https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications) -- MEDIUM confidence, vendor docs but pattern is well-established
- [Temporal Error Handling in Distributed Systems](https://temporal.io/blog/error-handling-in-distributed-systems) -- MEDIUM confidence
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- MEDIUM confidence, official Microsoft docs
- [Google Cloud Agentic AI Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) -- MEDIUM confidence, official Google docs
- [Partial Success in DAG Systems](https://medium.com/@kriyanshii/understanding-partial-success-in-dag-systems-building-resilient-workflows-977de786100f) -- LOW confidence, single source
- [Dark Factory Architecture Patterns](https://www.infralovers.com/blog/2026-02-22-architektur-patterns-dark-factory/) -- MEDIUM confidence, multiple sources align
- [Google Context-Aware Multi-Agent Framework](https://developers.googleblog.com/architecting-efficient-context-aware-multi-agent-framework-for-production/) -- MEDIUM confidence, official Google blog
