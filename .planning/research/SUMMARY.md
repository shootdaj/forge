# Project Research Summary

**Project:** Forge v1.1 — Flutter Mobile Verification
**Domain:** Flutter mobile app build, verification, and UAT integration into an autonomous CI orchestrator
**Researched:** 2026-03-28
**Confidence:** HIGH

## Executive Summary

Forge v1.1 adds Flutter mobile support to an autonomous CI/CD orchestrator that already handles web, API, and CLI projects. The integration follows a clear additive pattern: new verifiers (`mobile-build.ts`, `mobile-analyze.ts`) slot into the existing verifier registry, and a new UAT path (`emulator.ts` + `maestro.ts`) slots into the existing UAT gate. Critically, 80% of the Flutter verifier logic reuses existing Forge patterns — exit code checking, stdout parsing, and the `execWithTimeout` wrapper. The genuinely novel pieces are emulator lifecycle management and Maestro flow orchestration.

The recommended approach is Maestro CLI (v2.3.0) for mobile UAT, `flutter analyze` + `flutter test --machine` for verification, and `junit2json` as the single new npm dependency. Maestro was chosen over Appium (requires a daemon, no Flutter semantics tree access) and Detox (React Native only). The app type system should use `"flutter"` as a specific union member rather than a generic `"mobile"` type, enabling TypeScript's exhaustive switch checking to enforce complete handling at every branch site.

The top risks are operational, not architectural: Android emulators take 3-5 minutes to boot (with silent failure if not waited for), Flutter CLI has a global startup lock that deadlocks on concurrent invocations, and `flutter run` is a daemon process that never exits on its own. These must be addressed with `try/finally` teardown, a serialization mutex, and `spawn`-based process management respectively. Every one of these risks has a clear mitigation and the research identifies the exact implementation pattern for each.

---

## Key Findings

### Recommended Stack

The v1.1 stack adds one npm runtime dependency (`junit2json@3.2.0`) on top of the existing Forge stack. All other new components are external CLI tools that must be present on the host: Maestro CLI 2.3.0 (installed via `curl`, NOT `brew`), Flutter SDK, and Android SDK tools (`adb`, `emulator`, `avdmanager`). Forge should detect their presence at pipeline start and fail fast with actionable error messages if any are absent.

**Core new technologies:**
- `junit2json@3.2.0`: Parse Maestro JUnit XML output into TypeScript types — purpose-built, ESM+CJS, avoids writing a custom XML parser
- `Maestro CLI 2.3.0`: Mobile UAT via YAML flows with Flutter semantics tree access — zero Dart code required, YAML-based, has `--format junit` for machine-readable output
- `flutter test --machine`: NDJSON event stream for test results — use `done.success` field, filter non-JSON lines (Gradle contaminates stdout)
- `dart analyze --format machine`: Machine-parseable static analysis — use `--no-fatal-infos` flag, parse summary line (not just exit code)
- `adb` + `emulator`: Android emulator lifecycle — boot detection via `sys.boot_completed` polling, graceful teardown via `adb emu kill`

**Critical version and flag requirements:**
- Maestro install: `curl -Ls "https://get.maestro.mobile.dev" | bash` — `brew install maestro` installs the wrong product ("Maestro AI", a completely different tool)
- `flutter test --machine` not `--reporter json` — `--reporter` is a `dart test` flag, not valid on `flutter test`
- `emulator -no-audio -no-window -gpu swiftshader_indirect` — headless CI requires `swiftshader_indirect` (not `-gpu off`) to keep the accessibility framework functional for Maestro

### Expected Features

**Must have (P1 — required for end-to-end Flutter pipeline):**
- Flutter app type detection (`"flutter"` added to `AppType` union) — gate for all mobile paths
- `flutter pub get` verifier — dependency resolution must succeed before any other check
- `flutter analyze` verifier — primary code quality gate, analogous to existing typecheck verifier
- `flutter test` verifier — primary functional gate, analogous to existing test verifier
- `flutter build apk --debug` verifier — produces APK artifact required for emulator install
- Android emulator launch + boot-ready detection — prerequisite for Maestro
- `flutter run` app startup with stdout-based ready signal — gate before Maestro can interact
- Maestro flow generation from requirements — agent generates `.maestro/` YAML per user workflow
- Maestro flow execution + gap closure — UAT gate for mobile apps
- Semantic identifier guidance in context prompt — LOW cost, HIGH impact; prevents brittle coordinate-based flows

**Should have (P2 — add after first Flutter app runs end-to-end):**
- Mobile deployment config verifier (bundle ID, signing config checks)
- Flutter test pyramid enforcement (verify unit, widget, AND Maestro layers exist)
- iOS Simulator support (`flutter build ios --debug --no-codesign` + xcrun simctl)
- Flutter test coverage reporting (non-blocking — report number, no threshold enforcement)

**Defer (v2+):**
- Maestro Cloud integration — external service dependency, adds billing and auth complexity
- iOS physical device testing — requires Apple Developer account, provisioning profiles
- React Native support — different toolchain (Metro, Detox), defer to v1.2
- Visual regression testing — needs baseline infrastructure
- `assertWithAI` in generated flows — experimental, `optional: true` by default, unreliable in CI

### Architecture Approach

Flutter support integrates into Forge's existing two-layer verification architecture without modifying existing verifiers or the UAT runner's interface. New verifiers (`mobile-build.ts`, `mobile-analyze.ts`) follow the exact same `(config: VerifierConfig) => Promise<VerifierResult>` interface and self-skip via `skippedResult()` when `pubspec.yaml` is absent. The UAT gate grows two new modules (`emulator.ts`, `maestro.ts`) that are invoked only in the `"flutter"` branch of `runner.ts`. All changes are additive; no existing code paths change behavior.

**New modules:**
1. `src/verifiers/mobile-build.ts` — runs `flutter build apk --debug`, parses exit code and stderr errors, skips on missing `pubspec.yaml`
2. `src/verifiers/mobile-analyze.ts` — runs `flutter analyze --no-fatal-infos`, parses stdout summary line, skips on missing `pubspec.yaml`
3. `src/uat/emulator.ts` — `startEmulator`, `waitForEmulatorReady` (polls `adb shell getprop sys.boot_completed`), `stopEmulator` — self-contained lifecycle module with injected exec for unit testing
4. `src/uat/maestro.ts` — `runMaestroFlows()` returning `WorkflowResult[]` — runs `maestro test --format junit`, parses JUnit XML via `junit2json`, maps `<testcase>` to existing `WorkflowResult` type

**Modified modules (additive only):**
- `src/config/schema.ts`: +3 testing fields (`flutter_avd_name`, `flutter_build_flavor`, `maestro_flows_dir`), +2 verification toggles (`mobile_build`, `mobile_analyze`)
- `src/verifiers/index.ts`: register new verifiers, add to `configToRegistryMap`
- `src/uat/types.ts`: add `"flutter"` to `AppType` union
- `src/uat/runner.ts`: add `"flutter"` branches at 6 switch sites (TypeScript compile errors guide exactly which sites)

### Critical Pitfalls

1. **Flutter global startup lock deadlocks on concurrent CLI calls** — Serialize all `flutter` CLI invocations with a process-level mutex. Never `Promise.all` Flutter commands. If stdout contains "Waiting for another flutter command", kill the process and surface as a verifier error, not a hang. Must be baked in from day one — cannot be retrofitted. (Source: `flutter/flutter#16423`)

2. **Android emulator is a daemon that boots in 3-5 minutes with no exit signal** — After spawning the emulator with `spawn()` (not `exec`), poll `adb shell getprop sys.boot_completed` every 3 seconds with a 180-second timeout. Also check `pm path android` to confirm package manager is initialized. `adb wait-for-device` alone fires before boot completes.

3. **Emulator resource leak on test failure exhausts machine RAM after 3-4 runs** — Always run emulator lifecycle inside `try/finally`. Add `process.on('exit')` handler. On startup, enumerate and kill orphan emulators from previous crashed runs. Store PID and serial in `forge-state.json`.

4. **`flutter test --machine` stdout is contaminated by Gradle build output** — Filter lines: only parse lines starting with `{`. Read result from `DoneEvent.success` field, not exit code alone. Cross-check `done.success === false` OR any `TestDoneEvent` with `result !== "success"`. (Source: `flutter/flutter#123873`)

5. **`flutter run` never exits — it is a long-lived daemon** — Use `spawn()` with `detached: true`, wait for "Flutter run key commands" in stdout, store PID, kill by PID in `finally` block. Never use `exec` or `execWithTimeout` for `flutter run`.

6. **Maestro `--format junit` regression causes false failures** — Check BOTH exit code AND JUnit XML content. When they disagree, trust the XML. Known regression in Maestro 2.0.x (issue #2706) where exit code 1 is returned even when all flows passed. Re-verify behavior against 2.3.0 specifically.

7. **Headless Android emulator loses window focus — Maestro accessibility fails in CI** — Use `-gpu swiftshader_indirect` (not `-gpu off`). Avoid `killApp` + `launchApp` sequences in generated flows; use `clearState: true` instead. (Source: `mobile-dev-inc/maestro#2750`)

---

## Implications for Roadmap

Based on dependencies identified in research, the natural phase structure follows the verification chain: infrastructure first (AppType + verifiers + mutex), then emulator lifecycle, then UAT orchestration.

### Phase 1: Flutter Verifier Infrastructure

**Rationale:** Everything else depends on correct `AppType` detection and working verifiers. These are the simplest pieces (80% reuse of existing patterns) and must land first so the type system guides all subsequent work. The TypeScript compile errors from adding `"flutter"` to `AppType` will surface every unhandled branch site in `runner.ts` and serve as a natural checklist for Phase 2. The Flutter startup lock mutex must also land here — it cannot be retrofitted after verifiers are used in parallel contexts.

**Delivers:** Forge can detect Flutter projects and run `pub get`, `analyze`, `test`, and `build` verification without needing an emulator. KVM pre-flight check gates Phase 2 gracefully.

**Features addressed:**
- Flutter app type detection (`AppType = "flutter"`)
- `flutter pub get` verifier
- `flutter analyze` verifier
- `flutter test` verifier
- `flutter build apk --debug` verifier
- KVM pre-flight check (gates emulator steps)

**Config changes:**
- `src/config/schema.ts`: all 5 new fields with defaults
- `src/verifiers/index.ts`: register `mobile-build` and `mobile-analyze`
- `src/uat/types.ts`: add `"flutter"` to `AppType` union

**Pitfalls addressed:** Flutter startup lock (Pitfall 1), Gradle JSON contamination (Pitfall 4), `dart analyze` exit code ambiguity (Pitfall 7), KVM unavailability (Pitfall 6)

### Phase 2: Android Emulator Lifecycle

**Rationale:** The emulator is the most operationally novel and risky component. It must be built and unit-tested in isolation before wiring into the UAT path. The `try/finally` teardown and orphan cleanup patterns must be proven correct before Maestro is added — otherwise debug sessions are polluted by leaked emulator state. No real emulator is required for Phase 2 unit tests: inject a mock `execFn` that simulates `adb shell getprop` returning `""`, `""`, then `"1"`.

**Delivers:** Forge can reliably start an Android emulator, wait for full boot readiness, and guarantee teardown on any exit path (success, failure, or crash).

**Features addressed:**
- `src/uat/emulator.ts` — `startEmulator`, `waitForEmulatorReady`, `stopEmulator`
- `process.on('exit')` handler for cleanup
- Orphan emulator detection on startup
- Emulator PID/serial tracking in `forge-state.json`
- `-gpu swiftshader_indirect` in emulator startup flags

**Pitfalls addressed:** Emulator startup timing (Pitfall 2), emulator resource leak (Pitfall 3), headless window focus loss (Pitfall 12 — configure `swiftshader_indirect` here)

### Phase 3: Maestro UAT Integration

**Rationale:** Maestro depends on a working emulator (Phase 2) and correct `AppType` routing (Phase 1). This is where the end-to-end Flutter pipeline becomes testable for the first time. The `flutter run` daemon management and Maestro flow generation are the two highest-complexity pieces and belong in the same phase — they are tightly coupled via the app-ready signal detection that gates when Maestro may begin.

**Delivers:** Forge can generate Maestro flows from requirements, install and launch the app on the emulator, run flows, and drive gap closure on failures. End-to-end Flutter pipeline is complete.

**Features addressed:**
- `src/uat/maestro.ts` — `runMaestroFlows()`, JUnit XML parsing, defense-in-depth result checking (exit code AND XML content)
- `flutter run` spawn + stdout-based "Flutter run key commands" ready signal + PID teardown in `finally`
- `src/uat/runner.ts` — 6 new `"flutter"` branches guided by Phase 1 TypeScript compile errors
- Maestro flow generator prompt (semantic identifier guidance, `waitForAnimationToEnd` after navigation)
- Maestro gap closure integration with existing `runUATGapClosure`

**Pitfalls addressed:** `flutter run` daemon hang (Pitfall 11), Maestro animation flakiness (Pitfall 5), Maestro `--format junit` regression (Pitfall 10), headless flow template patterns (Pitfall 12)

### Phase Ordering Rationale

- Phase 1 before Phase 2: the config schema changes and `AppType` union must exist before emulator code can reference `ForgeConfig.testing.flutterAvdName`. TypeScript will not compile otherwise.
- Phase 1 before Phase 2: the Flutter startup lock mutex must exist before any emulator-adjacent code runs, because `flutter build` (used before emulator start) and `flutter analyze` would race if invoked concurrently.
- Phase 2 before Phase 3: Maestro requires a running, fully booted emulator. Building them in separate phases means Phase 2 can be validated with unit tests using mocked exec before any real AVD involvement.
- The 9-item "Looks Done But Isn't" checklist from PITFALLS.md maps directly to acceptance criteria across all three phases. Use it as the primary definition-of-done for each phase.

### Research Flags

Phases with well-documented patterns (skip `/gsd:research-phase`):
- **Phase 1** (Flutter Verifier Infrastructure): Standard Forge verifier pattern, 80% reuse. Official Flutter/Dart docs cover all command flags with HIGH confidence. No research needed.
- **Phase 2** (Android Emulator Lifecycle): Official Android developer docs cover all `adb` and `emulator` commands. The `spawn` + polling pattern is well-understood. No research needed.

Phases likely needing a focused spike before implementation:
- **Phase 3** (Maestro UAT Integration): The `--format junit` regression (issue #2706) was reported in 2.0.x but has "intermittently fixed/broken across patch versions." Before building the result parser, run a 5-minute spike: `maestro test --format junit` against a trivial Flutter app at version 2.3.0 and record the exit code. If exit code 0, simple check is sufficient. If exit code 1 despite passing flows, the defense-in-depth dual-check parser is required. This spike costs 5 minutes and saves a potentially incorrect design.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Maestro version verified via GitHub API (`cli-2.3.0`, 2026-03-10). All CLI flags verified against official docs. `junit2json` verified on npm. `flutter test --machine` spec confirmed from dart-lang/test JSON reporter spec. |
| Features | HIGH | Official Maestro and Flutter docs cover all P1 features. Feature dependencies derived from actual command prerequisites, not speculation. Anti-features list grounded in concrete tooling limitations. |
| Architecture | HIGH | Based on direct reading of existing Forge source (`src/verifiers/`, `src/uat/`, `src/config/schema.ts`). Integration points are concrete — exact file paths and function signatures identified. |
| Pitfalls | HIGH | All critical pitfalls backed by GitHub issue numbers (`flutter/flutter`, `mobile-dev-inc/maestro`) with confirmed reproduction. Not theoretical — each has a closed or open issue reference with specific version information. |

**Overall confidence:** HIGH

### Gaps to Address

- **Maestro 2.3.0 `--format junit` regression status**: Issue #2706 was reported in 2.0.x. Confirm behavior against 2.3.0 specifically with a 5-minute spike before building the Maestro result parser in Phase 3. If fixed, simpler exit-code-only check is sufficient; if not, dual-check parser is required.

- **`dart analyze` exit code edge case on older Dart versions**: The research recommends parsing the stdout summary line as defense-in-depth against a known bug where exit code 0 was returned despite warnings. Validate against the actual Flutter SDK version in the target project during Phase 1 implementation.

- **"Flutter run key commands" signal stability**: This stdout pattern is well-known in the community but not formally documented as a stable API contract. Consider adding a fallback: if the signal is not seen within 60 seconds but `adb devices` shows the device connected and the app process is running, proceed with a warning log.

- **iOS Simulator support (P2 feature)**: PITFALLS.md covers CocoaPods staleness and `xcrun simctl` hang issues. When iOS path comes up (post-v1.1), dedicated research on the `xcrun simctl boot` + SpringBoard ready detection pattern is needed — the Android boot detection pattern does not translate directly.

---

## Sources

### Primary (HIGH confidence)
- [Maestro CLI Commands and Options](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) — `maestro test` flags, `--format junit`, `start-device` command
- [Maestro Flutter Support](https://docs.maestro.dev/get-started/supported-platform/flutter) — semantic identifier targeting, element priority order (semantics identifier > text > semanticLabel > coordinates)
- [dart-lang/test JSON Reporter Spec](https://github.com/dart-lang/test/blob/master/pkgs/test/doc/json_reporter.md) — complete NDJSON event protocol for `flutter test --machine`
- [Android Developer: adb reference](https://developer.android.com/tools/adb) — `sys.boot_completed`, `adb emu kill`, `adb wait-for-device`
- [Android Developer: Emulator command line](https://developer.android.com/studio/run/emulator-commandline) — `-no-window`, `-no-audio`, `-gpu` flags
- [Flutter Testing Overview](https://docs.flutter.dev/testing/overview) — test pyramid, `flutter test`, widget tests
- [Dart analyze documentation](https://dart.dev/tools/dart-analyze) — `--format machine`, `--fatal-warnings`, exit code behavior
- GitHub API: `mobile-dev-inc/maestro/releases/latest` — version `cli-2.3.0` confirmed, published 2026-03-10
- Existing Forge source (`src/verifiers/`, `src/uat/`, `src/config/schema.ts`) — direct read, architecture integration points confirmed

### Secondary (MEDIUM confidence)
- [Maestro assertWithAI docs](https://docs.maestro.dev/reference/commands-available/assertwithai) — experimental status, `optional: true` default
- [Headless Android emulator: swiftshader_indirect approach](https://gist.github.com/nhtua/2d294f276dc1e110a7ac14d69c37904f) — `-no-window -gpu swiftshader_indirect`
- [GitHub Actions: Hardware-accelerated Android virtualization](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/) — larger Linux runners support KVM
- [Flutter CI/CD with Codemagic](https://www.freecodecamp.org/news/build-a-complete-flutter-ci-cd-pipeline-with-codemagic/) — CI pipeline pattern reference
- [junit2json on npm](https://www.npmjs.com/package/junit2json) — v3.2.0, TypeScript types, ESM/CJS

### Issue tracker references (HIGH confidence — direct reproduction confirmed)
- `flutter/flutter#16423` — Flutter global startup lock (concurrent CLI calls deadlock)
- `flutter/flutter#123873` — Gradle output contaminating `flutter test` JSON stdout
- `flutter/flutter#168896` — Gradle daemon Java version mismatch in CI
- `mobile-dev-inc/maestro#1703` — Animation flakiness after navigation (closed "not planned")
- `mobile-dev-inc/maestro#2706` — `--format` flag causes false failures (known regression, intermittently fixed)
- `mobile-dev-inc/maestro#2750` — Headless CI app relaunch accessibility failure (open)

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
