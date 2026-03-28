---
status: passed
phase: 12-ios-simulator-support
source: [programmatic verification — infrastructure phase]
started: 2026-03-28T10:38:00Z
updated: 2026-03-28T10:40:00Z
---

## Tests

### 1. iOS Simulator Lifecycle (IOS-01)
expected: System can boot iOS Simulator via `xcrun simctl boot`, detect readiness by polling device state for "Booted", and guarantee shutdown in try/finally
result: pass
evidence: |
  - `src/uat/ios-simulator.ts` implements `bootSimulator()`, `waitForSimulatorReady()`, `shutdownSimulator()`, `withSimulator()`
  - `bootSimulator()` calls `assertXcodeAvailable()` pre-flight, parses `xcrun simctl list devices available -j` JSON, runs `xcrun simctl boot <udid>`
  - `waitForSimulatorReady()` polls `xcrun simctl list devices -j` until `state === "Booted"` with 120s timeout
  - `withSimulator()` uses try/finally to guarantee `shutdownSimulator()` runs
  - `registerSimulatorCleanup()` attaches process.on('exit'/'SIGINT'/'SIGTERM') handlers
  - 25 unit tests pass in `src/uat/ios-simulator.test.ts`
  - 7 integration tests pass in `test/integration/ios-simulator-integration.test.ts`

### 2. Flutter iOS Build --no-codesign (IOS-02)
expected: Flutter iOS builds run with `--no-codesign --simulator` flags, no Apple Developer account required
result: pass
evidence: |
  - `src/verifiers/flutter-build-ios.ts` runs `flutter build ios --debug --no-codesign --simulator`
  - Self-skips on non-macOS platforms with `skippedResult("flutter-build-ios", "iOS builds only supported on macOS")`
  - Self-skips when `pubspec.yaml` absent
  - Verifies `.app` bundle at `build/ios/iphonesimulator/Runner.app`
  - Uses `withFlutterLock()` for startup lock serialization
  - 600s timeout for iOS builds (slower than Android)
  - 9 unit tests pass in `src/verifiers/flutter-build-ios.test.ts`

### 3. Maestro Flows on iOS Simulator (IOS-03)
expected: Same Maestro flow YAML files used for Android run against iOS Simulator
result: pass
evidence: |
  - `src/uat/runner.ts` `runFlutterUAT()` routes by `config.testing.mobilePlatform` — "android" uses `withEmulator()`, "ios" uses `withSimulator()`
  - Inner Maestro UAT logic extracted to `runMaestroUATInner()` — shared between both platforms
  - Same `flowsDir` (`.maestro/`) passed to `executeMaestroUAT()` regardless of platform
  - `maestro test --device <udid>` accepts both Android serial and iOS Simulator UDID
  - 3 scenario tests verify platform routing and flow sharing in `test/scenarios/ios-uat-scenario.test.ts`
  - Scenario `TestiOSUATFlow_SameFlowsAsBothPlatforms` explicitly verifies identical flow directory

### 4. Config and State Extensions
expected: Config schema has mobilePlatform and iosSimulatorDevice fields; state schema tracks simulator UDID
result: pass
evidence: |
  - `src/config/schema.ts` has `mobile_platform: z.enum(["android", "ios"]).default("android")`
  - `src/config/schema.ts` has `ios_simulator_device: z.string().default("")`
  - `src/state/schema.ts` has `SimulatorStateSchema` with `udid`, `name`, `started_at`
  - ForgeConfig interface has `mobilePlatform` and `iosSimulatorDevice`
  - ForgeState interface has `simulator` with `udid`, `name`, `startedAt`
  - 35 existing config/state tests still pass

### 5. Full Test Suite Regression
expected: All existing tests continue to pass after Phase 12 changes
result: pass
evidence: |
  - 1044 tests pass across 77 test files (up from 816 across 58 files)
  - 228 new tests added in Phase 12 and prior v1.1 phases
  - Zero regressions in existing v1.0 functionality

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
