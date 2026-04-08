# Phase 13: Incremental Spec Compliance — Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the batched spec compliance loop with an incremental fix-one-verify-one approach. Each gap is fixed individually in its own SDK session, verified (including regression check on previously-passing requirements), and committed or reverted via git reset. Gap count must monotonically decrease (or stay flat from deferred gaps) — never increase.

</domain>

<decisions>
## Implementation Decisions

### Fix Strategy
- **D-01:** Each gap gets its own SDK session (runStep call) — no batch fixing
- **D-02:** After each individual fix, re-verify the fixed requirement AND run regression checks on all previously-passing requirements
- **D-03:** If a fix causes any regression (a previously-passing requirement now fails), revert via `git reset --hard` to the pre-fix commit and defer the gap to the next round
- **D-04:** Track a "passing set" and "gap set" that are updated after each fix-verify cycle

### Git Integration
- **D-05:** Before each individual fix attempt, record the current git HEAD SHA as a restore point
- **D-06:** After successful fix+verify (no regressions), commit the changes with a descriptive message
- **D-07:** On regression detection, `git reset --hard <restore-point>` to cleanly revert all changes from that fix attempt
- **D-08:** Git operations use the existing `execFn` injection pattern from PipelineContext (add if not present) for testability

### Convergence & Monotonicity
- **D-09:** Gap count monotonically decreases: after each round (all gaps attempted once), the new gap count must be <= previous round's gap count
- **D-10:** Gaps deferred due to regressions count toward the gap count (they're still gaps), but don't indicate worsening — worsening means gaps that WERE passing now fail
- **D-11:** Keep the existing `checkConvergence()` function but adapt it for the new incremental model

### Prompts
- **D-12:** Fix prompts include the list of currently-passing requirements with instruction: "These requirements currently pass — your changes MUST NOT break them"
- **D-13:** Fix prompts include the specific gap description and full requirement text
- **D-14:** Reuse `buildTargetedGapFixPrompt` as the base, extended with regression-awareness context

### API Surface
- **D-15:** `runSpecComplianceLoop()` keeps its existing signature — this is a behavioral change, not an API change
- **D-16:** Add a new `runIncrementalComplianceLoop()` that `runSpecComplianceLoop()` delegates to
- **D-17:** The pipeline controller (`pipeline-controller.ts`) requires no changes — it just calls `runSpecComplianceLoop()`

### Claude's Discretion
- Exact wording of regression-awareness prompt sections
- Whether to verify ALL passing requirements or use sampling for regression checks (recommended: verify all for correctness, can optimize later)
- Internal data structures for tracking fix/verify state within a round

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec Compliance
- `src/pipeline/spec-compliance.ts` — Current batched compliance loop implementation (the file being refactored)
- `src/pipeline/spec-compliance.test.ts` — Existing tests that must continue to pass
- `src/pipeline/prompts.ts` — Prompt builders including `buildBatchGapFixPrompt` and `buildTargetedGapFixPrompt`

### Pipeline Integration
- `src/pipeline/pipeline-controller.ts` — Calls `runSpecComplianceLoop()` from `executeFromWave3()`
- `src/pipeline/types.ts` — `SpecComplianceResult`, `PipelineContext` type definitions

### Step Runner
- `src/step-runner/step-runner.ts` — `runStep()` function used for SDK sessions

### Testing Patterns
- `src/pipeline/spec-compliance.test.ts` — Existing test patterns with mock contexts
- `test/` — Project test directory structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runStep()` — Already handles individual SDK sessions with cost tracking
- `buildTargetedGapFixPrompt()` — Targeted fix prompt for single requirements (extend with regression context)
- `verifyRequirementsBatch()` — Batch verification (reuse for regression checking)
- `verifyRequirement()` — Individual requirement verification
- `checkConvergence()` — Convergence checking (adapt for incremental model)
- `makeMockContext()` in tests — Well-structured test helper for creating mock pipeline contexts

### Established Patterns
- Pipeline context injection via `PipelineContext` — all external deps injected
- `execFn` injection pattern exists in PipelineContext for shell commands
- State updates via `ctx.stateManager.update()` with functional updater pattern
- Step naming convention: `fix-gap-targeted-{id}-round-{round}`

### Integration Points
- `runSpecComplianceLoop()` is called from `executeFromWave3()` in pipeline-controller.ts
- Return type `SpecComplianceResult` is unchanged
- Git operations need `execFn` from PipelineContext (already available)

</code_context>

<specifics>
## Specific Ideas

- The Palate app showed gap count going 25 -> 15 -> 24 with batched fixes — this is the exact regression pattern incremental fixes prevent
- Each gap's fix-verify cycle should be isolated: fix one thing, verify it works AND nothing broke, then commit or revert
- The git commit/revert pattern gives a clean audit trail of what worked and what didn't

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

## Testing Requirements

### Unit Tests
- `checkConvergence()` with incremental gap history patterns
- `buildIncrementalGapFixPrompt()` includes passing requirements list
- Git restore point recording and reset logic (mocked execFn)
- Monotonic gap decrease validation
- Regression detection from verify results

### Integration Tests
- `runIncrementalComplianceLoop()` with mock SDK that simulates:
  - Fix succeeds, verify passes, no regressions -> commit
  - Fix succeeds, verify passes, regression detected -> revert
  - Multiple gaps in sequence with mixed success/revert
  - Gap count monotonically decreases across rounds
- Prompt content includes passing requirements in fix prompts

### Scenario Tests
- Full `runSpecComplianceLoop()` flow with incremental behavior:
  - All gaps fixed in one round (happy path)
  - Some gaps deferred due to regressions, fixed in next round
  - Non-convergence detection (gaps not decreasing)
  - State updates reflect incremental progress

*Phase: 13-incremental-spec-compliance*
*Context gathered: 2026-04-08*
