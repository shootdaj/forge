# Requirements: Forge v1.1 — Flutter Mobile Support

**Defined:** 2026-03-28
**Core Value:** Forge can build, verify, and UAT Flutter mobile apps end-to-end with the same programmatic verification guarantees as web/API/CLI apps.

## v1.1 Requirements

### App Type Detection

- [ ] **DET-01**: System detects Flutter projects via pubspec.yaml and routes to mobile verification/UAT path
- [ ] **DET-02**: AppType union extended to include "flutter" with exhaustive switch enforcement at all branch sites

### Flutter Verifiers

- [ ] **FV-01**: Flutter pub get verifier checks dependency resolution succeeds before any other Flutter check
- [ ] **FV-02**: Flutter analyze verifier runs dart analyze --fatal-warnings with machine-parseable output
- [ ] **FV-03**: Flutter test verifier runs flutter test --machine, parses NDJSON events, filters Gradle contamination from stdout
- [ ] **FV-04**: Flutter build verifier runs flutter build apk --debug and confirms APK artifact exists
- [ ] **FV-05**: All Flutter verifiers self-skip via skippedResult() when pubspec.yaml is absent
- [ ] **FV-06**: Flutter startup lock mutex serializes all flutter CLI invocations to prevent deadlock

### Config Extension

- [ ] **CFG-04**: Config schema adds flutter_avd_name, flutter_build_flavor, maestro_flows_dir with safe defaults
- [ ] **CFG-05**: Verification config adds mobile_build and mobile_analyze toggles (default false)

### Emulator Lifecycle

- [ ] **EMU-01**: System can start an Android emulator with headless flags (-no-audio -no-window -gpu swiftshader_indirect)
- [ ] **EMU-02**: System polls adb shell getprop sys.boot_completed until "1" with 180s timeout for boot readiness
- [ ] **EMU-03**: Emulator teardown runs in try/finally — guaranteed cleanup on success, failure, or crash
- [ ] **EMU-04**: On startup, system detects and kills orphan emulators from previous crashed runs
- [ ] **EMU-05**: Emulator PID and serial tracked in forge-state.json for crash recovery
- [ ] **EMU-06**: KVM pre-flight check gates emulator steps gracefully with actionable error message

### Maestro UAT

- [ ] **MAE-01**: System runs maestro test --format junit against generated flow files and parses JUnit XML output
- [ ] **MAE-02**: Maestro result parsing uses defense-in-depth: checks both exit code AND JUnit XML content (known regression workaround)
- [ ] **MAE-03**: Flutter app started via flutter run as spawned daemon with stdout-based ready signal detection ("Flutter run key commands")
- [ ] **MAE-04**: flutter run process killed by PID in finally block — never left running
- [ ] **MAE-05**: UAT prompts include semantic identifier guidance so agent generates Maestro-friendly widgets
- [ ] **MAE-06**: Maestro UAT integrates with existing gap closure loop (runUATGapClosure)
- [ ] **MAE-07**: Generated Maestro flows include waitForAnimationToEnd after navigation to prevent flakiness

### Mobile Safety

- [ ] **SAF-01**: Mobile safety guardrails: no real device permissions, sandboxed testing, test Firebase projects only
- [ ] **SAF-02**: Context prompts include mobile deployment-awareness (signing config, bundle ID, platform-specific builds)

### iOS Simulator

- [ ] **IOS-01**: System can boot iOS Simulator via xcrun simctl and detect readiness
- [ ] **IOS-02**: Flutter build for iOS uses --no-codesign flag (no Apple Developer account needed for Simulator)
- [ ] **IOS-03**: Maestro flows run against iOS Simulator as alternative to Android emulator

## Future Requirements (v2+)

- Maestro Cloud integration (external service dependency)
- iOS physical device testing (requires Apple Developer account)
- React Native support (different toolchain — Metro, Detox)
- Visual regression testing (needs baseline infrastructure)
- assertWithAI in generated flows (experimental, unreliable in CI)

## Out of Scope

| Feature | Reason |
|---------|--------|
| React Native | Different toolchain entirely; defer to v1.2 |
| Physical iOS devices | Requires Apple certificates, provisioning profiles |
| Maestro Cloud | External service, adds billing complexity |
| Visual regression baselines | Infrastructure not yet in place |
| Web/API/CLI changes | v1.0 paths are stable, don't touch |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DET-01 | — | Pending |
| DET-02 | — | Pending |
| FV-01 | — | Pending |
| FV-02 | — | Pending |
| FV-03 | — | Pending |
| FV-04 | — | Pending |
| FV-05 | — | Pending |
| FV-06 | — | Pending |
| CFG-04 | — | Pending |
| CFG-05 | — | Pending |
| EMU-01 | — | Pending |
| EMU-02 | — | Pending |
| EMU-03 | — | Pending |
| EMU-04 | — | Pending |
| EMU-05 | — | Pending |
| EMU-06 | — | Pending |
| MAE-01 | — | Pending |
| MAE-02 | — | Pending |
| MAE-03 | — | Pending |
| MAE-04 | — | Pending |
| MAE-05 | — | Pending |
| MAE-06 | — | Pending |
| MAE-07 | — | Pending |
| SAF-01 | — | Pending |
| SAF-02 | — | Pending |
| IOS-01 | — | Pending |
| IOS-02 | — | Pending |
| IOS-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 28 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 28

---
*Requirements defined: 2026-03-28*
