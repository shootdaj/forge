# Phase 16: Parallel Gap Fixing - Context

**Gathered:** 2026-04-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Speed up the spec compliance gap-fixing loop by analyzing file overlap between gaps, grouping independent gaps into clusters, and fixing non-overlapping gaps concurrently. Gaps within the same cluster (sharing files) are fixed sequentially to preserve regression safety. The incremental fix-one-verify-one pattern from Phase 13 is preserved within each cluster.

</domain>

<decisions>
## Implementation Decisions

### File Overlap Detection
- **D-01:** Enhance the verification verdict to include an optional `files` field — an array of file paths the agent identified as relevant to the gap
- **D-02:** Update the batch verification prompt to ask the agent to report which source files each failing requirement touches
- **D-03:** Extract file lists from the enhanced verdict results; fall back to treating all gaps as conflicting (sequential) if file info is missing
- **D-04:** The `files` field is informational for clustering only — it does not need to be exhaustive, just accurate enough to detect overlap

### Clustering Algorithm
- **D-05:** Build a conflict graph where gaps are nodes and edges connect gaps that share at least one file
- **D-06:** Use greedy graph coloring to assign gaps to independent groups (colors)
- **D-07:** Gaps in the same color group are independent (no shared files) and can run concurrently
- **D-08:** Gaps in different color groups may share files and are sequenced in waves (all gaps of color 1 first, then color 2, etc.) — actually inverted: gaps of the SAME color run concurrently, different colors run in waves
- **D-09:** If no file info is available for a gap, it conflicts with all other gaps (conservative fallback)

### Concurrency Model
- **D-10:** Use `Promise.allSettled` for concurrent execution within each independent group
- **D-11:** Configurable max concurrency with default of 3 (added to ForgeConfig or passed as parameter)
- **D-12:** Each concurrent gap fix still follows the Phase 13 pattern: record restore point, fix, commit, verify, regression check, revert on failure
- **D-13:** Concurrent gaps operate on the same git repo — since they touch independent files, their commits should not conflict

### Regression Safety
- **D-14:** Within a cluster (gaps sharing files), the Phase 13 sequential fix-one-verify-one pattern is preserved exactly
- **D-15:** After all parallel fixes in a wave complete, run a full regression check on all previously-passing requirements
- **D-16:** If the post-wave regression check finds issues, identify which concurrent fix caused the regression and revert it
- **D-17:** Gap count must still monotonically decrease — parallel execution must not break convergence

### API Surface
- **D-18:** Add new function `analyzeGapOverlap()` that takes gap verdicts and returns clustered groups
- **D-19:** Add new function `buildConflictGraph()` and `colorGraph()` as pure utility functions (easy to unit test)
- **D-20:** Modify `runIncrementalComplianceLoop()` to use parallel execution when file overlap info is available
- **D-21:** `runSpecComplianceLoop()` signature unchanged — this is an internal optimization
- **D-22:** Add `maxParallelGapFixes` to ForgeConfig (default: 3)

### Claude's Discretion
- Exact implementation of the p-limit or similar concurrency limiter (could use a simple semaphore pattern)
- Whether to use a third-party graph coloring library or implement greedy coloring inline (recommended: inline, it's ~20 lines)
- Granularity of post-wave regression checking (full batch vs sampling)
- Internal data structures for tracking per-gap fix results during concurrent execution

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec Compliance (primary files being modified)
- `src/pipeline/spec-compliance.ts` — Current incremental compliance loop (Phase 13 implementation)
- `src/pipeline/spec-compliance.test.ts` — Existing tests that must continue to pass
- `src/pipeline/prompts.ts` — Prompt builders including `buildIncrementalGapFixPrompt`

### Pipeline Integration
- `src/pipeline/pipeline-controller.ts` — Calls `runSpecComplianceLoop()` from `executeFromWave3()`
- `src/pipeline/types.ts` — `SpecComplianceResult`, `PipelineContext` type definitions

### Step Runner
- `src/step-runner/step-runner.ts` — `runStep()` with watchdog timeout (Phase 15)

### Config
- `src/config/schema.ts` — ForgeConfig type (needs `maxParallelGapFixes` field)

### Phase 13 Context (predecessor)
- `.planning/phases/13-incremental-spec-compliance-fix-one-verify-one-loop-with-git-rollback-and-regression-aware-prompts/13-CONTEXT.md` — Decisions on incremental fix pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runIncrementalComplianceLoop()` — The sequential loop to be enhanced with parallelism
- `verifyRequirementsBatch()` — Batch verification (reuse for regression checking after parallel waves)
- `verifyRequirement()` — Individual requirement verification
- `checkConvergence()` — Convergence checking (works as-is with gap history)
- `execGitCommand()` — Git operations with injectable exec function
- `buildIncrementalGapFixPrompt()` — Per-gap fix prompt (reuse within each concurrent fix)

### Established Patterns
- Pipeline context injection via `PipelineContext` — all external deps injected
- `execFn` injection for testable git operations
- State updates via `ctx.stateManager.update()` with functional updater
- Step naming convention: `fix-gap-incremental-{id}-round-{round}`

### Integration Points
- `runSpecComplianceLoop()` delegates to `runIncrementalComplianceLoop()` — this delegation point stays
- Verification verdicts are `{ id, passed, gapDescription }` — needs `files?: string[]` addition
- Git commit/revert pattern within each gap fix — works independently per gap if files don't overlap

</code_context>

<specifics>
## Specific Ideas

- The Palate app had 25 gaps in some rounds — fixing them one-by-one is slow. If 15 of those gaps touch independent files, we could fix 3-5 at a time for significant speedup.
- Graph coloring is the right abstraction: gaps are nodes, shared files are edges, colors are parallel execution groups.
- Conservative fallback (treat unknown-file gaps as conflicting with everything) ensures safety even with imperfect file detection.
- The verification prompt enhancement to report files is low-risk — it's additive information that doesn't change verification behavior.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

## Testing Requirements

### Unit Tests
- `buildConflictGraph()` — correct edges from shared files, handles empty file lists
- `colorGraph()` — greedy coloring produces valid independent groups
- `analyzeGapOverlap()` — end-to-end clustering from gap verdicts to execution groups
- Conservative fallback when file info is missing
- Concurrency limiter respects maxParallelGapFixes config

### Integration Tests
- `runIncrementalComplianceLoop()` with mock SDK simulating parallel gap fixes:
  - Independent gaps fixed concurrently (verify they don't wait for each other)
  - Overlapping gaps fixed sequentially within cluster
  - Post-wave regression check catches and reverts problematic fixes
  - Mixed concurrent and sequential execution in same round
- Verification prompt includes file list request and parses response

### Scenario Tests
- Full `runSpecComplianceLoop()` with parallel behavior:
  - All gaps independent — maximum parallelism achieved
  - All gaps overlapping — falls back to sequential (Phase 13 behavior)
  - Mixed independent/overlapping clusters
  - Convergence still works (gap count monotonically decreases)
  - State updates reflect parallel progress
  - Timeout handling for concurrent gap fixes

*Phase: 16-parallel-gap-fixing*
*Context gathered: 2026-04-08*
