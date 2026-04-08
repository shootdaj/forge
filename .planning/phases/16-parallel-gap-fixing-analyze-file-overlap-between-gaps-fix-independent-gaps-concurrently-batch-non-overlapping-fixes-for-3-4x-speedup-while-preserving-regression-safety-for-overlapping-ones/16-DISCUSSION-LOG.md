# Phase 16: Parallel Gap Fixing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 16-parallel-gap-fixing
**Areas discussed:** File overlap detection, Clustering algorithm, Concurrency model, Regression safety
**Mode:** --auto (all choices auto-selected)

---

## File Overlap Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Add `files` field to verdict | Enhance verification prompt to report relevant files per gap | auto |
| Parse from gap descriptions | Use NLP/regex to extract file paths from gap text | |
| Static analysis | Analyze requirement IDs to infer files from code structure | |

**User's choice:** [auto] Add `files` field to verdict (recommended default)
**Notes:** The agent can report which files it examined during verification. This is additive — doesn't change verification behavior.

---

## Clustering Algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Conflict graph + greedy coloring | Build graph where shared files = edges, color for independent groups | auto |
| Simple disjoint sets | Group gaps by exact file set match | |
| Requirement-based heuristic | Cluster by requirement category/prefix | |

**User's choice:** [auto] Conflict graph + greedy coloring (recommended default)
**Notes:** Matches the design approach described in the phase title. Well-understood algorithm, easy to implement and test.

---

## Concurrency Model

| Option | Description | Selected |
|--------|-------------|----------|
| Promise.allSettled + max concurrency | Standard pattern with configurable limit (default 3) | auto |
| Worker threads | Node.js worker_threads for true parallelism | |
| Sequential with async overlap | Pipeline-style overlap between fix and verify | |

**User's choice:** [auto] Promise.allSettled + max concurrency (recommended default)
**Notes:** Explicitly stated in success criteria. Simple, well-understood, testable.

---

## Regression Safety Across Clusters

| Option | Description | Selected |
|--------|-------------|----------|
| Post-wave full regression check | After all parallel fixes complete, verify all passing requirements | auto |
| Cross-cluster locking | Acquire file locks before each fix | |
| Isolated branches per cluster | Each cluster works in its own git branch, merge after | |

**User's choice:** [auto] Post-wave full regression check (recommended default)
**Notes:** Preserves Phase 13's safety model. Independent gaps don't share files, so concurrent fixes shouldn't conflict. Post-wave check is the safety net.

---

## Claude's Discretion

- Concurrency limiter implementation (simple semaphore vs p-limit library)
- Graph coloring implementation (inline ~20 lines vs library)
- Post-wave regression granularity (full batch vs sampling)

## Deferred Ideas

None — discussion stayed within phase scope
