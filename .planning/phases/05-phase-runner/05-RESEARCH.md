# Phase 5: Phase Runner + Plan Verification + Gap Closure - Research

**Researched:** 2026-03-05
**Domain:** Lifecycle orchestration, plan verification, checkpoint/resume, gap closure
**Confidence:** HIGH

## Summary

Phase 5 builds the phase runner -- the orchestration layer that sequences a complete phase lifecycle (context gathering, planning, plan verification, execution, programmatic verification, gap closure, documentation) using the step runner (Phase 3) and verifiers (Phase 4) as primitives. This is a composition layer, not a new primitive -- it wires together existing, well-tested components with new logic for plan verification, test task injection, root cause diagnosis, and checkpoint-based resumability.

The codebase already has strong foundations: `runStep()` and `runStepWithCascade()` handle all SDK interaction with budget enforcement and failure cascade, `runVerifiers()` handles all programmatic verification with parallel execution and docker gating, `StateManager` provides crash-safe persistence with atomic writes and mutex, and `ForgeConfig` supplies all the configuration knobs. Phase 5's job is to compose these into a deterministic state machine with well-defined checkpoints.

**Primary recommendation:** Build the phase runner as a pure function `runPhase(phaseNumber, config, stateManager, stepRunnerContext, costController)` that takes all dependencies as parameters. Each substep (context, plan, verify-plan, execute, verify-build, gap-closure, docs) should be an independent function that reads/writes checkpoint files, making the phase runner a simple sequencer with checkpoint-based resume logic.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `runPhase()` is the top-level function that executes the full phase lifecycle
- Each substep (context, plan, verify-plan, execute, verify-build, gap-closure, docs) is a separate function
- Phase runner checks for existing checkpoints on startup and resumes from last completed substep
- Checkpoint files: CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md, GAPS.md
- Phase lifecycle steps: context gathering -> plan creation -> plan verification -> test task injection -> re-planning -> execution -> verification -> root cause diagnosis -> test gap filling -> checkpoint creation -> resumability
- Plan verification: parse PLAN.md to extract requirement IDs, cross-reference against phase requirements, check test task presence
- Gap closure: max 2 rounds, root cause diagnosis categorizes failures, targeted fix plan, only fix plan executed
- Checkpoint order: CONTEXT.md -> PLAN.md (verified) -> execution complete -> VERIFICATION.md -> GAPS.md (if needed) -> PHASE_REPORT.md

### Claude's Discretion
- Exact heuristics for gray area detection in context gathering
- How to structure the root cause diagnosis prompt
- Mock instruction format for external services
- Phase report template structure
- Whether to use streaming or batch output for progress reporting

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PHA-01 | Phase runner executes full cycle: context -> plan -> verify plan -> execute -> test -> gap closure -> docs | Architecture pattern: state machine with checkpoint-based substeps |
| PHA-02 | Context gathering detects gray areas, locks decisions in CONTEXT.md, captures deferred ideas | Use runStep() with GSD discuss-phase prompt; verify CONTEXT.md exists |
| PHA-03 | Plan creation via GSD plan-phase, produces PLAN.md | Use runStep() with GSD plan-phase prompt; verify PLAN.md exists |
| PHA-04 | Plan verification checks requirement coverage, test task presence, execution order, success criteria, no scope creep | Pure function: parsePlan() + verifyPlanCoverage(); no SDK call needed |
| PHA-05 | Missing test tasks are injected into plan automatically (deterministic code edit) | File edit via string manipulation; append test tasks section to PLAN.md |
| PHA-06 | Missing requirement coverage triggers re-planning with specific feedback | Use runStep() with re-plan prompt including missing requirement IDs |
| PHA-07 | Execution runs with mock instructions for external services + failure cascade | Use runStepWithCascade() with execution prompt; mock instructions in prompt |
| PHA-08 | After execution, all programmatic verifiers run | Call runVerifiers() from Phase 4 |
| PHA-09 | Test failures trigger root cause diagnosis -> targeted fix plan -> execute fix | Use runStep() with structured output for diagnosis; execute fix with runStep() |
| PHA-10 | Test coverage gaps trigger gsd:add-tests to generate missing tests | Use runStep() with add-tests prompt; verify with coverage verifier |
| PHA-11 | Phase creates file-based checkpoints (CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md, GAPS.md) | Write checkpoint files at each substep completion |
| PHA-12 | Phase runner resumes from last checkpoint on restart (skip completed substeps) | Check for checkpoint file existence before each substep |
| GAP-01 | Root cause diagnosis categorizes failures: wrong approach, missing dependency, integration mismatch, requirement ambiguity, environment issue | Structured output schema with category enum |
| GAP-02 | Targeted fix plan created based on diagnosis (specific files, specific fix, specific retest) | Structured output schema with files_to_change, fix_description, retest_command |
| GAP-03 | Only the fix plan is executed, not the entire phase again | Gap closure calls runStep() with targeted prompt, not runPhase() |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | (already installed) | Agent SDK for query() calls | Core dependency; already proven in Phases 1-3 |
| `zod` | (already installed) | Schema validation for structured outputs | Already used for config and state schemas |
| `node:fs` | built-in | File I/O for checkpoints | Standard Node.js; no additional dependency needed |
| `node:path` | built-in | Path manipulation for phase directories | Standard Node.js |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (already installed) | Testing framework | All unit/integration/scenario tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| String parsing for PLAN.md | Markdown AST parser (remark) | Adds dependency; PLAN.md format is controlled by us so regex/string parsing is sufficient |
| Custom state machine lib | xstate | Overkill; the phase lifecycle is a linear sequence with checkpoint resume, not a complex state machine |

**Installation:**
No new dependencies needed. Phase 5 composes existing primitives.

## Architecture Patterns

### Recommended Project Structure
```
src/
  phase-runner/
    index.ts               # Public API: runPhase(), PhaseResult
    types.ts               # PhaseConfig, PhaseResult, PlanVerificationResult, GapDiagnosis, etc.
    phase-runner.ts         # Main runPhase() function: checkpoint sequencer
    substeps/
      context.ts            # gatherContext() -- PHA-02
      plan.ts               # createPlan() -- PHA-03
      plan-verification.ts  # verifyPlan(), injectTestTasks() -- PHA-04, PHA-05, PHA-06
      execute.ts            # executePlan() -- PHA-07
      verify-build.ts       # verifyBuild() -- PHA-08
      gap-closure.ts        # diagnoseFailures(), executeGapClosure() -- PHA-09, GAP-01..03
      test-gaps.ts          # fillTestGaps() -- PHA-10
      docs.ts               # generatePhaseReport() -- checkpoint writing
    checkpoint.ts           # Checkpoint detection/writing logic -- PHA-11, PHA-12
    prompts.ts              # All prompt builders (context, plan, execute, diagnosis, fix)
```

### Pattern 1: Checkpoint-Based Resume (PHA-11, PHA-12)

**What:** Each substep checks for its checkpoint file before executing. If the file exists, the substep is skipped. On completion, the substep writes the checkpoint file.

**When to use:** Every substep in the phase lifecycle.

**Example:**
```typescript
// The phase runner is a simple checkpoint sequencer
interface CheckpointState {
  contextDone: boolean;   // CONTEXT.md exists
  planDone: boolean;      // PLAN.md exists (and verified)
  executionDone: boolean; // marker file or state flag
  verificationDone: boolean; // VERIFICATION.md exists
  gapsDone: boolean;      // GAPS.md exists (or no gaps needed)
  reportDone: boolean;    // PHASE_REPORT.md exists
}

function detectCheckpoints(phaseDir: string): CheckpointState {
  return {
    contextDone: fs.existsSync(path.join(phaseDir, 'CONTEXT.md')),
    planDone: fs.existsSync(path.join(phaseDir, 'PLAN.md')),
    executionDone: /* check state.phases[N].status === 'in_progress' with last step */,
    verificationDone: fs.existsSync(path.join(phaseDir, 'VERIFICATION.md')),
    gapsDone: fs.existsSync(path.join(phaseDir, 'GAPS.md')),
    reportDone: fs.existsSync(path.join(phaseDir, 'PHASE_REPORT.md')),
  };
}
```

**Key insight:** Checkpoint files serve double duty -- they are both the output artifacts of each substep AND the resume markers. No separate checkpoint tracking needed.

### Pattern 2: Pure Function Plan Verification (PHA-04, PHA-05)

**What:** Plan verification is a pure function that takes plan content and requirement IDs, returns structured results. No SDK call needed.

**When to use:** After plan creation, before execution.

**Example:**
```typescript
interface PlanVerificationResult {
  passed: boolean;
  coveredRequirements: string[];      // Requirement IDs found in plan
  missingRequirements: string[];      // Required IDs not in plan
  hasTestTasks: boolean;              // Whether plan includes test tasks
  missingTestTasks: string[];         // Components without test tasks
  executionOrderValid: boolean;       // Dependencies respected
  hasSuccessCriteria: boolean;        // Tasks have verification criteria
  scopeCreep: string[];              // Tasks not mapping to any requirement
}

function verifyPlan(
  planContent: string,
  phaseRequirementIds: string[],
): PlanVerificationResult {
  // Parse PLAN.md, extract requirement refs, check coverage
}
```

### Pattern 3: Structured Output for Root Cause Diagnosis (GAP-01, GAP-02)

**What:** Use executeQuery with outputSchema to get a typed root cause diagnosis from the agent.

**When to use:** After verification failures, before gap closure.

**Example:**
```typescript
interface GapDiagnosis {
  category: 'wrong_approach' | 'missing_dependency' | 'integration_mismatch' | 'requirement_ambiguity' | 'environment_issue';
  description: string;
  affectedFiles: string[];
  suggestedFix: string;
  retestCommand: string;
}

// Use runStep with structured output schema
const diagnosisResult = await runStep('gap-diagnosis', {
  prompt: buildDiagnosisPrompt(verificationReport, phaseContext),
  verify: async () => true,  // diagnosis always "passes" -- we just need the output
  outputSchema: gapDiagnosisSchema,
}, ctx, costController);
```

### Pattern 4: Dependency Injection for Testability

**What:** The phase runner takes all dependencies as parameters, enabling tests to mock the SDK, file system, and state.

**When to use:** The `runPhase()` entry point and all substeps.

**Example:**
```typescript
interface PhaseRunnerContext {
  config: ForgeConfig;
  stateManager: StateManager;
  stepRunnerContext: StepRunnerContext;
  costController: CostController;
  // File system abstraction for testing
  fs?: {
    existsSync: typeof fs.existsSync;
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
    mkdirSync: typeof fs.mkdirSync;
  };
}
```

### Anti-Patterns to Avoid
- **Do NOT re-implement step execution.** Use `runStep()` and `runStepWithCascade()` from Phase 3. The phase runner composes, it does not duplicate.
- **Do NOT call the SDK directly.** All SDK interaction goes through `runStep()` which handles budget, cost tracking, and error categorization.
- **Do NOT put verification logic in prompts.** Verification is code (Phase 4 verifiers), not agent self-report. The phase runner calls `runVerifiers()`, not a verification prompt.
- **Do NOT retry the entire phase on failure.** Gap closure is targeted -- diagnose, create fix plan, execute only the fix, re-verify only affected areas.
- **Do NOT store checkpoint state in forge-state.json.** Checkpoint state is the existence of files in the phase directory. forge-state.json tracks high-level phase status, not substep progress.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Budget enforcement | Custom budget checks | `runStep()` + `CostController` from Phase 3 | Already handles pre-step checks, per-step limits, cost logging |
| Failure cascade | Custom retry loop | `runStepWithCascade()` from Phase 3 | Already implements retry-3x -> skip -> stop with error context |
| Programmatic verification | Custom test/lint runners | `runVerifiers()` from Phase 4 | Already runs 8 verifiers in parallel with docker gating |
| State persistence | Custom file writing | `StateManager.update()` from Phase 2 | Already handles atomic writes, mutex, snake/camel mapping |
| Markdown parsing (complex) | Full AST parser | String search + regex | PLAN.md format is controlled by GSD; simple pattern matching suffices |
| Structured output | JSON parsing from text | `outputSchema` on `StepOptions` | SDK handles structured output extraction; already proven in Phase 1 |

**Key insight:** Phase 5 is primarily a composition layer. The hard work of SDK interaction, budget enforcement, verification, and state management is already done. The new logic is plan verification (string parsing), checkpoint sequencing (file existence checks), and root cause diagnosis (prompt engineering with structured output).

## Common Pitfalls

### Pitfall 1: Checkpoint File vs. State Confusion
**What goes wrong:** Mixing checkpoint detection (file existence) with state tracking (forge-state.json) leads to inconsistent resume behavior.
**Why it happens:** Tempting to track substep progress in state, but state tracks high-level phase status while checkpoints are the substep-level resume markers.
**How to avoid:** Use a clear rule: checkpoint files are the source of truth for substep resume. State only tracks overall phase status (pending, in_progress, completed, partial, failed). Update state at phase start/end, not at each substep.
**Warning signs:** State has fields like `contextDone`, `planDone`, etc. -- these should be checkpoint files, not state fields.

### Pitfall 2: Infinite Gap Closure Loops
**What goes wrong:** Gap closure runs forever because each fix introduces new failures.
**Why it happens:** The fix for failure A breaks thing B, which triggers a new diagnosis, whose fix breaks thing C.
**How to avoid:** CONTEXT.md specifies max 2 rounds. Implement as a hard counter: if gap closure runs twice and verification still fails, stop and report remaining gaps. Do NOT increment beyond 2.
**Warning signs:** Gap closure round count not checked before starting a new round.

### Pitfall 3: Plan Verification Regex Fragility
**What goes wrong:** Plan verification fails to detect requirement IDs because the plan uses a slightly different format than expected.
**Why it happens:** GSD generates plans with varying formats. A regex expecting `REQ-01` might miss `req-01` or `PHA-01` or inline references.
**How to avoid:** Case-insensitive matching. Support multiple patterns: `PHA-01`, `PHA01`, `(PHA-01)`, `[PHA-01]`, requirement text without ID. Test with real plan samples from GSD.
**Warning signs:** Plan verification always says "missing requirements" even when they're addressed in the plan.

### Pitfall 4: Test Task Injection Breaking Plan Structure
**What goes wrong:** Injected test tasks break the plan's markdown structure, causing the agent to misinterpret the plan during execution.
**Why it happens:** Naive string append without understanding the plan's format.
**How to avoid:** Inject test tasks as a well-structured section at the end of the plan, with clear task numbering that continues from the existing plan. Include a comment marker (e.g., `<!-- FORGE:INJECTED_TEST_TASKS -->`) for traceability.
**Warning signs:** Execution step fails because the plan looks malformed to the agent.

### Pitfall 5: Not Passing Phase Context to Each Substep
**What goes wrong:** The execution step doesn't have access to decisions made during context gathering, or the verification step doesn't know what the plan expected.
**Why it happens:** Each substep runs in a fresh query() call, so context must be explicitly passed via prompts.
**How to avoid:** Each prompt builder reads the checkpoint files from prior substeps. The execution prompt includes CONTEXT.md decisions. The verification prompt includes PLAN.md expected files. The gap closure prompt includes VERIFICATION.md failures.
**Warning signs:** Agent makes decisions during execution that contradict CONTEXT.md decisions.

### Pitfall 6: Resuming Mid-Execution
**What goes wrong:** The phase runner can resume after context/plan/verification, but can't resume mid-execution (the longest substep).
**Why it happens:** Execution is a single runStep() call that may take many turns. If the process crashes mid-execution, there's no substep-level checkpoint within execution.
**How to avoid:** For v1, accept that execution restarts from the beginning of the execution substep (the agent will see existing files and adapt). The state tracks phase status as "in_progress" during execution. On resume, re-run execution with a prompt that says "continue from where you left off -- check existing files first." In the future, could use session resume if the SDK supports it.
**Warning signs:** Re-execution from scratch wastes budget on work already done.

## Code Examples

### Example 1: Phase Runner Main Loop
```typescript
export async function runPhase(
  phaseNumber: number,
  ctx: PhaseRunnerContext,
): Promise<PhaseResult> {
  const phaseDir = resolvePhaseDir(phaseNumber, ctx.config);
  const checkpoints = detectCheckpoints(phaseDir);
  const phaseReqs = getPhaseRequirements(phaseNumber); // from ROADMAP.md

  // Update state: phase in progress
  await ctx.stateManager.update(state => ({
    ...state,
    phases: {
      ...state.phases,
      [String(phaseNumber)]: {
        ...(state.phases[String(phaseNumber)] ?? { status: 'pending', attempts: 0, budgetUsed: 0 }),
        status: 'in_progress',
        startedAt: state.phases[String(phaseNumber)]?.startedAt ?? new Date().toISOString(),
      },
    },
  }));

  // 1. Context gathering (skip if checkpoint exists)
  if (!checkpoints.contextDone) {
    await gatherContext(phaseNumber, phaseDir, ctx);
  }

  // 2. Plan creation (skip if checkpoint exists)
  if (!checkpoints.planDone) {
    await createPlan(phaseNumber, phaseDir, ctx);
  }

  // 3. Plan verification (always run -- idempotent)
  const planResult = await verifyAndFixPlan(phaseNumber, phaseDir, phaseReqs, ctx);
  if (!planResult.passed) {
    return { status: 'failed', reason: 'Plan verification failed after re-planning' };
  }

  // 4. Execution (skip if checkpoint exists)
  if (!checkpoints.executionDone) {
    await executePlan(phaseNumber, phaseDir, ctx);
  }

  // 5. Verification
  if (!checkpoints.verificationDone) {
    const verificationReport = await verifyBuild(phaseNumber, phaseDir, ctx);

    // 6. Gap closure (if verification failed)
    if (!verificationReport.passed) {
      await runGapClosure(phaseNumber, phaseDir, verificationReport, ctx);
    }
  }

  // 7. Documentation
  if (!checkpoints.reportDone) {
    await generatePhaseReport(phaseNumber, phaseDir, ctx);
  }

  // Update state: phase complete
  await ctx.stateManager.update(state => ({
    ...state,
    phases: {
      ...state.phases,
      [String(phaseNumber)]: {
        ...state.phases[String(phaseNumber)],
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    },
  }));

  return { status: 'completed' };
}
```

### Example 2: Plan Verification (Pure Function)
```typescript
export function parsePlanRequirements(planContent: string): string[] {
  // Match requirement IDs in various formats: PHA-01, (PHA-01), [PHA-01], etc.
  const pattern = /\b([A-Z]+-\d+)\b/gi;
  const matches = planContent.matchAll(pattern);
  const ids = new Set<string>();
  for (const match of matches) {
    ids.add(match[1].toUpperCase());
  }
  return [...ids];
}

export function verifyPlanCoverage(
  planContent: string,
  requiredIds: string[],
): PlanVerificationResult {
  const coveredIds = parsePlanRequirements(planContent);
  const missing = requiredIds.filter(id => !coveredIds.includes(id));

  // Check for test tasks
  const hasTestKeywords = /\b(test|tests|testing|unit test|integration test|scenario test)\b/i;
  const hasTestTasks = hasTestKeywords.test(planContent);

  // Simple heuristic for scope creep: look for requirement IDs not in the phase
  const allIdsInPlan = coveredIds;
  const scopeCreep = allIdsInPlan.filter(
    id => !requiredIds.includes(id) && !id.startsWith('TEST') && !id.startsWith('GEN')
  );

  return {
    passed: missing.length === 0 && hasTestTasks,
    coveredRequirements: coveredIds.filter(id => requiredIds.includes(id)),
    missingRequirements: missing,
    hasTestTasks,
    missingTestTasks: [], // computed separately by checking each component
    executionOrderValid: true, // basic check: tasks are numbered sequentially
    hasSuccessCriteria: planContent.includes('Success') || planContent.includes('Verification'),
    scopeCreep,
  };
}
```

### Example 3: Root Cause Diagnosis Schema
```typescript
const gapDiagnosisSchema = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: ['wrong_approach', 'missing_dependency', 'integration_mismatch', 'requirement_ambiguity', 'environment_issue'],
    },
    description: { type: 'string' },
    affectedFiles: { type: 'array', items: { type: 'string' } },
    suggestedFix: { type: 'string' },
    retestCommand: { type: 'string' },
  },
  required: ['category', 'description', 'affectedFiles', 'suggestedFix', 'retestCommand'],
};
```

### Example 4: Test Task Injection
```typescript
export function injectTestTasks(
  planContent: string,
  components: string[],
): string {
  const testSection = [
    '',
    '<!-- FORGE:INJECTED_TEST_TASKS -->',
    '## Injected Test Tasks',
    '',
    'The following test tasks were automatically injected by Forge plan verification.',
    '',
    ...components.map((comp, i) => [
      `### Test Task ${i + 1}: Write tests for ${comp}`,
      `- Unit tests for all public functions/methods`,
      `- Integration tests for any API endpoints or service interactions`,
      `- Scenario tests for user-facing workflows`,
      `- Success criteria: All tests pass, coverage verifier passes`,
      '',
    ]).flat(),
  ].join('\n');

  return planContent + testSection;
}
```

### Example 5: Gap Closure with Iteration Limit
```typescript
const MAX_GAP_CLOSURE_ROUNDS = 2;

export async function runGapClosure(
  phaseNumber: number,
  phaseDir: string,
  initialReport: VerificationReport,
  ctx: PhaseRunnerContext,
): Promise<void> {
  let currentReport = initialReport;

  for (let round = 1; round <= MAX_GAP_CLOSURE_ROUNDS; round++) {
    // Diagnose root cause
    const diagnosis = await diagnoseFailures(currentReport, phaseDir, ctx);

    // Execute targeted fix
    await executeTargetedFix(diagnosis, phaseNumber, ctx);

    // Re-verify
    currentReport = await runVerifiers({
      cwd: ctx.config.projectDir ?? process.cwd(),
      forgeConfig: ctx.config,
    });

    if (currentReport.passed) {
      // Write GAPS.md with closure history
      writeGapsReport(phaseDir, round, 'resolved', diagnosis);
      return;
    }
  }

  // Exhausted rounds -- write GAPS.md with remaining failures
  writeGapsReport(phaseDir, MAX_GAP_CLOSURE_ROUNDS, 'unresolved', currentReport);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Agent-based plan verification | Code-based plan verification | Forge design decision | Plan verification is deterministic, not stochastic |
| Blind retry on failure | Root cause diagnosis then targeted fix | Forge design decision | Fewer wasted iterations, better convergence |
| Full phase re-execution on failure | Targeted gap closure | Forge design decision | Cost savings, faster iteration |
| State-based checkpoint tracking | File-based checkpoint tracking | Phase 5 design | Simpler resume, checkpoint artifacts are also useful outputs |

**Deprecated/outdated:**
- None -- this is new domain logic, not dependent on external library versions.

## Open Questions

1. **Phase directory naming convention**
   - What we know: SPEC.md shows `.planning/phases/phase-N/`. CONTEXT.md for this phase is at `.planning/phases/05-phase-runner/`.
   - What's unclear: The target project Forge is building will have its own phase directories. The phase runner needs to resolve the correct path.
   - Recommendation: Accept the phase directory path as a parameter or derive from ROADMAP.md. For Forge's own phases, use the GSD convention (`XX-name`). For target projects, derive from the roadmap file.

2. **Execution resumability mid-step**
   - What we know: Checkpoint files cover substep-level resume. But execution itself is a single (potentially long) runStep() call.
   - What's unclear: If the process crashes mid-execution, re-running from execution start may duplicate work and waste budget.
   - Recommendation: For v1, accept this limitation. The execution prompt should instruct the agent to "check existing files and continue from where you left off." The SDK session resume feature could be explored in the future.

3. **How GSD plan-phase formats PLAN.md**
   - What we know: GSD skills generate markdown plans. The exact format (headers, task numbering, requirement ID references) varies.
   - What's unclear: Whether GSD consistently includes requirement IDs in plan output.
   - Recommendation: Plan verification should be resilient to format variations. Match requirement IDs case-insensitively, support multiple reference patterns. If GSD doesn't include them, the plan-phase prompt should explicitly request them.

4. **Structured output for diagnosis vs. text parsing**
   - What we know: The SDK supports `outputSchema` for JSON structured output (proven in Phase 1).
   - What's unclear: Whether the structured output reliability is high enough for diagnosis (which requires reading test output, source code, and reasoning about root cause).
   - Recommendation: Use structured output schema for diagnosis. If the agent can't produce valid JSON after retries, fall back to a simpler text-based diagnosis and apply a generic "re-run tests" approach.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (already configured) |
| Config file | `/Users/anshul/Anshul/Code/forge/vitest.config.ts` |
| Quick run command | `npx vitest run src/phase-runner/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PHA-01 | Full lifecycle execution | scenario | `npx vitest run test/scenarios/phase-runner.test.ts` | Wave 0 |
| PHA-02 | Context gathering | unit + integration | `npx vitest run src/phase-runner/substeps/context.test.ts` | Wave 0 |
| PHA-03 | Plan creation | unit + integration | `npx vitest run src/phase-runner/substeps/plan.test.ts` | Wave 0 |
| PHA-04 | Plan verification | unit | `npx vitest run src/phase-runner/substeps/plan-verification.test.ts` | Wave 0 |
| PHA-05 | Test task injection | unit | `npx vitest run src/phase-runner/substeps/plan-verification.test.ts` | Wave 0 |
| PHA-06 | Re-planning on missing coverage | integration | `npx vitest run src/phase-runner/substeps/plan-verification.test.ts` | Wave 0 |
| PHA-07 | Execution with cascade | integration | `npx vitest run src/phase-runner/substeps/execute.test.ts` | Wave 0 |
| PHA-08 | Verification after execution | unit + integration | `npx vitest run src/phase-runner/substeps/verify-build.test.ts` | Wave 0 |
| PHA-09 | Root cause diagnosis + targeted fix | unit + integration | `npx vitest run src/phase-runner/substeps/gap-closure.test.ts` | Wave 0 |
| PHA-10 | Test gap filling | integration | `npx vitest run src/phase-runner/substeps/test-gaps.test.ts` | Wave 0 |
| PHA-11 | Checkpoint creation | unit | `npx vitest run src/phase-runner/checkpoint.test.ts` | Wave 0 |
| PHA-12 | Resumability | unit + scenario | `npx vitest run src/phase-runner/checkpoint.test.ts` | Wave 0 |
| GAP-01 | Root cause categorization | unit | `npx vitest run src/phase-runner/substeps/gap-closure.test.ts` | Wave 0 |
| GAP-02 | Targeted fix plan | unit + integration | `npx vitest run src/phase-runner/substeps/gap-closure.test.ts` | Wave 0 |
| GAP-03 | Fix-only execution | integration + scenario | `npx vitest run test/scenarios/phase-runner.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/phase-runner/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `src/phase-runner/` directory -- all phase runner source files
- [ ] `src/phase-runner/substeps/` directory -- all substep implementations
- [ ] Test files for all new modules (listed above)
- [ ] `test/integration/phase-runner.test.ts` -- integration tests
- [ ] `test/scenarios/phase-runner.test.ts` -- scenario tests

## Implementation Details

### How the Phase Runner Uses Existing Primitives

**runStep() usage:**
- Context gathering: `runStep('phase-N-context', { prompt: contextPrompt, verify: () => fs.existsSync(CONTEXT.md) }, ctx, costController)`
- Plan creation: `runStep('phase-N-plan', { prompt: planPrompt, verify: () => fs.existsSync(PLAN.md) }, ctx, costController)`
- Re-planning: `runStep('phase-N-replan', { prompt: replanPrompt, verify: () => verifyPlan() passes }, ctx, costController)`
- Gap diagnosis: `runStep('phase-N-diagnose', { prompt: diagnosisPrompt, verify: () => true, outputSchema: diagnosisSchema }, ctx, costController)`
- Test gap filling: `runStep('phase-N-add-tests', { prompt: addTestsPrompt, verify: () => coverageVerifier passes }, ctx, costController)`
- Phase report: `runStep('phase-N-report', { prompt: reportPrompt, verify: () => fs.existsSync(PHASE_REPORT.md) }, ctx, costController)`

**runStepWithCascade() usage:**
- Execution: `runStepWithCascade('phase-N-execute', { prompt: executePrompt, verify: ..., onFailure: ... }, ctx, costController)`
- Gap closure fix: `runStepWithCascade('phase-N-gap-fix', { prompt: fixPrompt, verify: ..., onFailure: ..., maxRetries: 1 }, ctx, costController)` (limited retries since gap closure itself is already a retry mechanism)

**runVerifiers() usage:**
- After execution: `runVerifiers({ cwd, forgeConfig: config, expectedFiles })` -- returns VerificationReport
- After gap closure fix: same call, to re-verify

**StateManager usage:**
- Phase start: update phase status to 'in_progress'
- Phase end: update phase status to 'completed' or 'partial' or 'failed'
- Budget tracking: runStep() already handles this via CostController and StateManager

### Checkpoint Files and Their Content

| Checkpoint | Created By | Content | Resume Behavior |
|-----------|------------|---------|-----------------|
| CONTEXT.md | Context gathering substep | Gray areas, decisions, deferred ideas | Skip context gathering |
| PLAN.md | Plan creation substep (then modified by verification) | Task list, requirement mapping, test tasks | Skip plan creation; re-run plan verification (idempotent) |
| VERIFICATION.md | Verify-build substep | Verification report: verifier results, pass/fail | Skip verification; if gaps, check GAPS.md |
| GAPS.md | Gap closure substep | Diagnosis, fix plan, resolution status | Skip gap closure |
| PHASE_REPORT.md | Documentation substep | Phase summary, test results, budget, issues | Skip documentation |

### Root Cause Diagnosis Prompt Structure

The diagnosis prompt should include:
1. The full verification report (which verifiers failed, error details)
2. The plan that was executed (what was supposed to happen)
3. The context decisions (what constraints apply)
4. Instructions to output structured JSON with the diagnosis schema

The agent reads the failing test output, relevant source code, and reasons about the root cause. The structured output ensures we get a machine-parseable diagnosis.

### Mock Instructions in Execution Prompts

When a phase needs external services, the execution prompt includes:
```
External services in this phase must use mock implementations:
- For each external service, create: interface + mock + real + factory
- Tag mock files with: // FORGE:MOCK -- swap for real in Wave 2
- Mock implementations should return realistic but static data
- Register mock files in the mock registry state
```

This is injected by the phase runner based on mock service configuration passed from the pipeline controller (Phase 6). For Phase 5, we just need to support the mock instructions parameter; the actual mock detection logic is Phase 6's responsibility.

## Sources

### Primary (HIGH confidence)
- SPEC.md sections: Phase Runner (section 4), Plan Verification Gates, Gap Closure Strategy, Testing Pyramid -- read directly from codebase
- Existing codebase: src/step-runner/, src/verifiers/, src/config/, src/state/ -- read all source files
- 05-CONTEXT.md -- user decisions for this phase

### Secondary (MEDIUM confidence)
- Architecture patterns derived from existing codebase patterns (dependency injection, factory functions, type-safe discriminated unions)

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all primitives already proven
- Architecture: HIGH -- composition of well-tested components; patterns derived from existing codebase
- Pitfalls: HIGH -- based on direct analysis of the SPEC.md design and existing component interfaces

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable -- internal component composition, no external library risk)
