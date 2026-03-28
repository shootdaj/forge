# Phase 11: Maestro UAT Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 11-maestro-uat-integration
**Areas discussed:** Flutter Run Daemon Management, Maestro Test Execution, Maestro Flow Generation, Gap Closure Integration
**Mode:** auto (all gray areas auto-selected, recommended defaults chosen)

---

## Flutter Run Daemon Management

| Option | Description | Selected |
|--------|-------------|----------|
| Separate module (flutter-run.ts) | Self-contained module matching emulator.ts pattern | Yes |
| Inline in runner.ts | Add flutter run logic directly to UAT runner | |

**User's choice:** [auto] Separate module (recommended default)
**Notes:** Follows Phase 10 pattern. High-level `withFlutterRun()` wrapper enables try/finally cleanup.

---

## Maestro Test Execution and JUnit Parsing

| Option | Description | Selected |
|--------|-------------|----------|
| Defense-in-depth (exit code + XML) | Check both, trust XML when they disagree | Yes |
| Exit code only | Simple but unreliable with known Maestro regression | |
| XML only | Ignores exit code entirely | |

**User's choice:** [auto] Defense-in-depth (recommended default)
**Notes:** Research confirms Maestro 2.0.x regression (#2706). junit2json@3.2.0 for XML parsing.

---

## Maestro Flow Generation Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Agent-generated from requirements | Claude generates YAML flows based on app structure | Yes |
| Template-based | Predefined YAML templates filled in | |

**User's choice:** [auto] Agent-generated (recommended default)
**Notes:** Semantic identifier guidance in UAT prompt ensures quality flows. `waitForAnimationToEnd` required after navigation.

---

## Gap Closure Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing runUATGapClosure | Convert Maestro results to WorkflowResult[], use existing loop | Yes |
| New Maestro-specific gap closure | Separate gap closure logic for Maestro | |

**User's choice:** [auto] Reuse existing (recommended default)
**Notes:** MaestroResult maps cleanly to WorkflowResult[]. Gap closure prompt includes both app code and flow YAML fix instructions.

---

## Claude's Discretion

- Exact Maestro flow YAML structure
- Whether to add `--no-ansi` flag to Maestro CLI
- Internal log verbosity during flutter run stdout scanning
- Whether to validate generated Maestro YAML syntax before execution

## Deferred Ideas

- Maestro Cloud integration -- v2+
- Visual regression testing via Maestro screenshots -- v2+
- assertWithAI in flows -- experimental
- iOS Simulator Maestro testing -- Phase 12
