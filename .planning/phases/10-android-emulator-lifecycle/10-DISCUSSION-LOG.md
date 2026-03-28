# Phase 10: Android Emulator Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 10-android-emulator-lifecycle
**Areas discussed:** Module location, Boot polling, Teardown guarantee, Orphan detection, State extension, KVM check
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Module Location and API Shape

| Option | Description | Selected |
|--------|-------------|----------|
| `src/uat/emulator.ts` | Self-contained module alongside UAT runner | Yes |
| `src/emulator/` directory | Separate top-level directory | |

**User's choice:** [auto] `src/uat/emulator.ts` (recommended default)
**Notes:** Follows research SUMMARY.md suggestion. Emulator is only used during UAT, so co-location makes sense.

---

## Boot Readiness Polling

| Option | Description | Selected |
|--------|-------------|----------|
| Poll `sys.boot_completed` every 3s, 180s timeout | Standard approach per Android docs | Yes |
| `adb wait-for-device` only | Simpler but fires during early boot | |
| Poll multiple properties | More thorough but complex | |

**User's choice:** [auto] Poll `sys.boot_completed` every 3s, 180s timeout (recommended default)
**Notes:** `adb wait-for-device` is insufficient per research -- fires before system is ready.

---

## Teardown Guarantee

| Option | Description | Selected |
|--------|-------------|----------|
| Three-layer: try/finally + process.on('exit') + orphan cleanup | Maximum coverage | Yes |
| try/finally only | Simpler but misses crashes | |
| External cleanup script | Shell-based, harder to integrate | |

**User's choice:** [auto] Three-layer teardown (recommended default)
**Notes:** Research confirms emulator leak exhausts RAM after 3-4 runs. Three layers cover normal exit, crash, and previous-run orphans.

---

## Orphan Detection

| Option | Description | Selected |
|--------|-------------|----------|
| State file + `adb devices` cross-reference | Catches tracked and untracked orphans | Yes |
| State file only | Misses orphans from non-Forge runs | |
| `adb devices` only | Can't identify which emulators are stale | |

**User's choice:** [auto] Cross-reference state + adb devices (recommended default)
**Notes:** Belt-and-suspenders approach -- state file provides PID for targeted kill, adb devices provides ground truth.

---

## State Schema Extension

| Option | Description | Selected |
|--------|-------------|----------|
| Add `emulator` object with pid, serial, avd_name, started_at | Follows existing deployment state pattern | Yes |
| Flat fields (emulator_pid, emulator_serial) | Simpler but inconsistent | |

**User's choice:** [auto] Nested `emulator` object (recommended default)
**Notes:** Matches existing `deployment` state object pattern. Uses `z.any().default({}).pipe()` per MEMORY.md gotcha.

---

## KVM Pre-flight Check

| Option | Description | Selected |
|--------|-------------|----------|
| Platform-aware: skip on macOS, check /dev/kvm on Linux | Correct and minimal | Yes |
| Always check | Unnecessary on macOS, confusing | |
| Skip entirely | Would cause cryptic emulator failures | |

**User's choice:** [auto] Platform-aware check (recommended default)
**Notes:** macOS has HVF built-in. Linux needs explicit KVM check. Actionable error message helps CI setup.

---

## Claude's Discretion

- Internal logging verbosity during boot polling
- Exact grace period timing between graceful and forced kill
- Whether to add secondary boot indicator (`pm path android`)

## Deferred Ideas

- iOS Simulator lifecycle -- Phase 12
- Emulator snapshot management -- v2+
- GPU acceleration detection -- v2+
- Multiple concurrent emulator support -- v2+
