# Phase 10: Android Emulator Lifecycle — Verification

**Status:** passed
**Verified:** 2026-03-28
**Phase Goal:** Forge can reliably start an Android emulator, wait for full boot readiness, and guarantee teardown on any exit path

## Requirements Verification

| Requirement | Status | Evidence |
|-------------|--------|----------|
| EMU-01: Headless emulator start | PASS | `startEmulator()` in `src/uat/emulator.ts` spawns with `-no-audio -no-window -gpu swiftshader_indirect -no-boot-anim -no-snapshot-save`. Unit test `TestStartEmulator_SpawnsWithCorrectArgs` verifies args. |
| EMU-02: Boot readiness polling | PASS | `waitForBoot()` polls `adb -s <serial> shell getprop sys.boot_completed` every 3s, 180s timeout. Tests: `TestWaitForBoot_CompletesOnBootCompleted1`, `TestWaitForBoot_PollsUntilReady`, `TestWaitForBoot_TimeoutThrowsEmulatorBootTimeoutError`. |
| EMU-03: Guaranteed teardown | PASS | Three-layer guarantee: (1) `withEmulator()` try/finally, (2) `registerCleanupHandler()` process.on('exit'/'SIGINT'/'SIGTERM'), (3) `killOrphanEmulators()` on startup. Tests: `TestWithEmulator_CleansUpOnError`, `TestScenario_EmulatorLifecycle_CallbackError`. |
| EMU-04: Orphan detection/cleanup | PASS | `killOrphanEmulators()` cross-references forge-state.json PID/serial with `adb devices` output. Tests: `TestKillOrphanEmulators_KillsTrackedOrphan`, `TestKillOrphanEmulators_KillsUntrackedOrphans`, `TestScenario_EmulatorLifecycle_CrashRecovery`. |
| EMU-05: State persistence | PASS | `EmulatorStateSchema` in `src/state/schema.ts` tracks pid, serial, avd_name, started_at. `persistEmulatorState()`/`clearEmulatorState()` helpers. Tests: `TestForgeStateSchema_EmulatorWithValues`, `TestForgeStateSchema_EmulatorRoundTrip`. |
| EMU-06: KVM pre-flight check | PASS | `checkKvmAvailability()` in `src/uat/kvm-check.ts`: macOS always available (HVF), Linux checks `/dev/kvm`, actionable error messages. Tests: 12 KVM tests including `TestAssertKvmAvailable_ErrorMessage_Actionable`. |

## Success Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Headless emulator with correct flags | PASS | Args verified in startEmulator() and unit test |
| Always killed on success/failure/crash | PASS | try/finally + process handlers + orphan cleanup |
| Stale emulators detected and killed | PASS | killOrphanEmulators() with state + adb cross-reference |
| KVM unavailability produces actionable error | PASS | KvmUnavailableError with install instructions |
| PID and serial persisted in forge-state.json | PASS | EmulatorStateSchema with round-trip tests |

## Test Coverage

| Tier | Files | Tests | Status |
|------|-------|-------|--------|
| Unit | `src/uat/emulator.test.ts`, `src/uat/kvm-check.test.ts`, `src/state/state-manager.test.ts` | 45 new | All pass |
| Integration | `test/integration/emulator-lifecycle.test.ts` | 7 | All pass |
| Scenario | `test/scenarios/emulator-lifecycle.test.ts` | 5 | All pass |
| Full Suite | 69 files | 951 | All pass, 0 regressions |

## Must-Haves

- [x] Headless emulator starts with -no-audio -no-window -gpu swiftshader_indirect
- [x] Boot readiness detected via sys.boot_completed=1 with 180s timeout
- [x] try/finally + process.on('exit') guarantees teardown on all exit paths
- [x] Orphan emulators detected via state + adb devices cross-reference
- [x] Emulator PID/serial persisted in forge-state.json
- [x] KVM check returns actionable error on Linux when unavailable
- [x] All functions use injectable dependencies for testing without real Android SDK
- [x] withEmulator() provides high-level API for Phase 11 integration

## Files Created/Modified

### New Files
- `src/uat/emulator-types.ts` — Error classes and interfaces
- `src/uat/kvm-check.ts` — KVM pre-flight check
- `src/uat/kvm-check.test.ts` — 12 KVM unit tests
- `src/uat/emulator.ts` — Emulator lifecycle manager
- `src/uat/emulator.test.ts` — 29 emulator unit tests
- `test/integration/emulator-lifecycle.test.ts` — 7 integration tests
- `test/scenarios/emulator-lifecycle.test.ts` — 5 scenario tests

### Modified Files
- `src/state/schema.ts` — Added EmulatorStateSchema
- `src/state/state-manager.ts` — Added emulator field to createInitialState()
- `src/state/state-manager.test.ts` — Added 4 emulator state tests
- `src/uat/index.ts` — Export emulator module

## Gaps

None identified. All requirements met.

## Human Verification

Not applicable — this phase is pure backend infrastructure with no user-facing components. All behavior verified via automated tests with injectable mocks.
