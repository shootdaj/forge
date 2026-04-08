# Phase 13: Incremental Spec Compliance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 13-incremental-spec-compliance
**Areas discussed:** Fix Strategy, Git Integration, Convergence Model, Prompt Design, API Surface
**Mode:** Auto (all decisions auto-resolved with recommended defaults)

---

## Fix Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Individual fix-verify cycles | Each gap gets own SDK session + verify + commit/revert | Y |
| Batch fix with post-hoc regression check | Fix all gaps, then check for regressions | |
| Hybrid (small batches of 2-3) | Group related gaps into mini-batches | |

**User's choice:** [auto] Individual fix-verify cycles (recommended — prevents cross-gap interference that caused 25->15->24 regression)
**Notes:** This is the core motivation for Phase 13

---

## Git Integration

| Option | Description | Selected |
|--------|-------------|----------|
| git reset --hard to restore point | Record SHA before fix, hard reset on regression | Y |
| git stash/pop | Stash changes and pop on success | |
| Branch-per-fix | Create temporary branch for each fix attempt | |

**User's choice:** [auto] git reset --hard (recommended — simplest, cleanest, no branch proliferation)
**Notes:** Restore point is the HEAD SHA recorded before fix attempt

---

## Convergence Model

| Option | Description | Selected |
|--------|-------------|----------|
| Monotonic gap decrease per round | Gap count after full round must be <= previous round | Y |
| Strict decrease per individual fix | Every fix must reduce gap count | |
| Progress metric (fixes > regressions) | Track net progress across round | |

**User's choice:** [auto] Monotonic per round (recommended — individual fixes may defer gaps without indicating failure)

---

## Prompt Design

| Option | Description | Selected |
|--------|-------------|----------|
| Include passing set in fix prompt | Tell agent which requirements pass and must not break | Y |
| Include only the gap being fixed | Minimal context | |
| Include full gap list + passing list | Maximum context | |

**User's choice:** [auto] Include passing set (recommended — agent needs to know what not to break)

---

## API Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Keep existing signature, new internal function | runSpecComplianceLoop delegates to runIncrementalComplianceLoop | Y |
| Replace runSpecComplianceLoop entirely | Breaking change to internal API | |
| Add mode parameter | runSpecComplianceLoop(ids, ctx, { mode: 'incremental' }) | |

**User's choice:** [auto] Keep existing signature (recommended — no changes needed in pipeline-controller.ts)

---

## Claude's Discretion

- Exact prompt wording for regression-awareness sections
- Whether to verify all passing requirements or sample (verify all recommended)
- Internal data structures for tracking state within a round

## Deferred Ideas

None
