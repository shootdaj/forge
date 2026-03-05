# Phase 5: Phase Runner + Plan Verification + Gap Closure - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the phase runner that orchestrates a complete phase lifecycle: context gathering → plan creation → plan verification → execution → programmatic verification → gap closure → documentation. The phase runner uses the step runner (Phase 3) and verifiers (Phase 4) as primitives. It also manages file-based checkpoints for resumability and implements plan verification gates.

</domain>

<decisions>
## Implementation Decisions

### Phase Runner Architecture
- `runPhase()` is the top-level function that executes the full phase lifecycle
- Each substep (context, plan, verify-plan, execute, verify-build, gap-closure, docs) is a separate function
- Phase runner checks for existing checkpoints on startup and resumes from last completed substep
- Checkpoint files: CONTEXT.md, PLAN.md, VERIFICATION.md, PHASE_REPORT.md, GAPS.md

### Phase Lifecycle Steps (PHA-01)
1. **Context gathering** (PHA-02): Detect gray areas, lock decisions in CONTEXT.md, capture deferred ideas
2. **Plan creation** (PHA-03): Generate PLAN.md via GSD plan-phase (delegated to step runner with query())
3. **Plan verification** (PHA-04): Check requirement coverage, test task presence, execution order, success criteria, no scope creep
4. **Test task injection** (PHA-05): If plan is missing test tasks, inject them deterministically (code edit, not re-query)
5. **Re-planning** (PHA-06): If requirement coverage is missing, trigger re-plan with specific feedback
6. **Execution** (PHA-07): Run plan steps with mock instructions for external services + failure cascade
7. **Verification** (PHA-08): Run all programmatic verifiers from Phase 4
8. **Root cause diagnosis** (PHA-09): On test failure, diagnose root cause → targeted fix plan → execute fix (not blind retry)
9. **Test gap filling** (PHA-10): Run gsd:add-tests to generate missing tests
10. **Checkpoint creation** (PHA-11): Create file-based checkpoints at each substep
11. **Resumability** (PHA-12): Skip completed substeps on restart

### Plan Verification (PHA-04)
- Parse PLAN.md to extract requirement IDs and task list
- Cross-reference against phase's requirement IDs from ROADMAP.md
- Check that every requirement has at least one task implementing it
- Check that test tasks exist for each new component
- If test tasks missing → inject them (PHA-05) via deterministic file edit
- If requirements missing → return feedback for re-planning (PHA-06)

### Gap Closure (GAP-01, GAP-02, GAP-03)
- Root cause diagnosis categorizes failures: wrong approach, missing dependency, integration mismatch, requirement ambiguity, environment issue
- Targeted fix plan created based on diagnosis (specific files, specific fix, specific retest)
- Only the fix plan is executed, not the entire phase again
- Gap closure has max 2 rounds to prevent infinite loops

### Checkpoint & Resumability
- Each substep writes a checkpoint file on completion
- On startup, check which checkpoints exist and skip completed substeps
- Checkpoint order: CONTEXT.md → PLAN.md (verified) → execution complete → VERIFICATION.md → GAPS.md (if needed) → PHASE_REPORT.md
- Resuming mid-execution: check state for last completed step within the plan

### Claude's Discretion
- Exact heuristics for gray area detection in context gathering
- How to structure the root cause diagnosis prompt
- Mock instruction format for external services
- Phase report template structure
- Whether to use streaming or batch output for progress reporting

</decisions>

<specifics>
## Specific Ideas

- Plan verification should be a pure function that takes plan content and requirement IDs and returns {passed, missingRequirements, missingTestTasks}
- Root cause diagnosis should produce a structured output: {category, description, affectedFiles, suggestedFix}
- The phase runner should use runStep() from step-runner for any query() calls it makes
- Verifiers from Phase 4 should be called via runVerifiers() after execution

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 05-phase-runner*
*Context gathered: 2026-03-05*
