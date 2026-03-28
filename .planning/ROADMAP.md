# Roadmap: Forge

## Milestones

- ✅ **v1.0 MVP** — Phases 1-8 (shipped 2026-03-08) — [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Flutter Mobile Support** — Phases 9-12 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-8) — SHIPPED 2026-03-08</summary>

- [x] Phase 1: SDK Proof of Concept (1/1 plans) — completed 2026-03-05
- [x] Phase 2: Foundation — Config + State (2/2 plans) — completed 2026-03-05
- [x] Phase 3: Step Runner + Cost Controller (1/1 plans) — completed 2026-03-05
- [x] Phase 4: Programmatic Verifiers (2/2 plans) — completed 2026-03-05
- [x] Phase 5: Phase Runner + Plan Verification + Gap Closure (3/3 plans) — completed 2026-03-05
- [x] Phase 6: Pipeline Controller — Wave Model (4/4 plans) — completed 2026-03-05
- [x] Phase 7: CLI + Git + Testing Infrastructure (3/3 plans) — completed 2026-03-05
- [x] Phase 8: Enhancement Layer (4/4 plans) — completed 2026-03-05

</details>

### 🚧 v1.1 Flutter Mobile Support (In Progress)

**Milestone Goal:** Forge can build, verify, and UAT Flutter mobile apps end-to-end with the same programmatic verification guarantees as web/API/CLI apps.

- [ ] **Phase 9: Flutter Verifier Infrastructure** — App type detection, config extension, Flutter verifiers, startup lock mutex, mobile safety guardrails
- [ ] **Phase 10: Android Emulator Lifecycle** — Emulator start/boot/teardown, orphan cleanup, crash recovery, KVM pre-flight
- [ ] **Phase 11: Maestro UAT Integration** — Maestro flow generation, flutter run daemon, UAT execution, gap closure integration
- [ ] **Phase 12: iOS Simulator Support** — iOS simulator boot, no-codesign iOS build, Maestro flows on iOS

## Phase Details

### Phase 9: Flutter Verifier Infrastructure
**Goal**: Forge detects Flutter projects and runs pub get, analyze, test, and build verification without needing a device or emulator
**Depends on**: Phase 8 (v1.0 complete)
**Requirements**: DET-01, DET-02, FV-01, FV-02, FV-03, FV-04, FV-05, FV-06, CFG-04, CFG-05, SAF-01, SAF-02
**Success Criteria** (what must be TRUE):
  1. Running Forge against a Flutter project routes to the Flutter verification and UAT path; running it against a non-Flutter project routes to existing paths unchanged
  2. The `flutter pub get`, `flutter analyze`, `flutter test`, and `flutter build apk` verifiers each run, report pass/fail, and self-skip when pubspec.yaml is absent
  3. Running two Flutter verifiers concurrently does not deadlock — the startup lock mutex serializes them
  4. Context prompts given to the agent include mobile deployment-awareness (signing config, bundle ID) and safety guardrails (no real device permissions, test Firebase only)
  5. Config schema accepts `flutter_avd_name`, `flutter_build_flavor`, `maestro_flows_dir`, `mobile_build`, and `mobile_analyze` fields with documented defaults
**Plans**: TBD
**UI hint**: no

### Phase 10: Android Emulator Lifecycle
**Goal**: Forge can reliably start an Android emulator, wait for full boot readiness, and guarantee teardown on any exit path
**Depends on**: Phase 9
**Requirements**: EMU-01, EMU-02, EMU-03, EMU-04, EMU-05, EMU-06
**Success Criteria** (what must be TRUE):
  1. Forge starts a headless Android emulator with `-no-audio -no-window -gpu swiftshader_indirect` flags and waits for `sys.boot_completed=1` before proceeding
  2. On success, failure, or crash the emulator is always killed — no orphan processes remain after a Forge run
  3. When Forge starts and a stale emulator from a previous crashed run is detected, it is killed before a new one is launched
  4. If KVM is unavailable, Forge exits with an actionable error message before attempting emulator operations
  5. Emulator PID and serial are persisted in forge-state.json so a restarted Forge can kill the orphan
**Plans**: TBD
**UI hint**: no

### Phase 11: Maestro UAT Integration
**Goal**: Forge generates Maestro flows from requirements, launches the Flutter app on the emulator, runs UAT, and drives gap closure on failures
**Depends on**: Phase 10
**Requirements**: MAE-01, MAE-02, MAE-03, MAE-04, MAE-05, MAE-06, MAE-07
**Success Criteria** (what must be TRUE):
  1. Forge spawns `flutter run` as a daemon, detects the "Flutter run key commands" ready signal in stdout, and kills the process by PID in a finally block — it is never left running
  2. Forge runs `maestro test --format junit`, checks both exit code and JUnit XML content (neither alone is trusted), and reports accurate pass/fail results
  3. Generated Maestro flows target widgets by semantic identifier (not coordinates), include `waitForAnimationToEnd` after navigation, and are syntactically valid YAML
  4. UAT failures trigger the existing gap closure loop, which re-runs until flows pass or budget is exhausted
  5. End-to-end: a Flutter app built by Forge passes Maestro UAT on the first attempt after gap closure completes
**Plans**: TBD
**UI hint**: no

### Phase 12: iOS Simulator Support
**Goal**: Forge can boot an iOS Simulator, build the Flutter app without code signing, and run Maestro flows against it as an alternative to Android
**Depends on**: Phase 11
**Requirements**: IOS-01, IOS-02, IOS-03
**Success Criteria** (what must be TRUE):
  1. Forge can boot an iOS Simulator via `xcrun simctl` and detect when it is ready to accept app installs
  2. Flutter iOS builds run with `--no-codesign` — no Apple Developer account or provisioning profile is required
  3. The same Maestro flows used for Android run successfully against the iOS Simulator
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. SDK Proof of Concept | v1.0 | 1/1 | Complete | 2026-03-05 |
| 2. Foundation (Config + State) | v1.0 | 2/2 | Complete | 2026-03-05 |
| 3. Step Runner + Cost Controller | v1.0 | 1/1 | Complete | 2026-03-05 |
| 4. Programmatic Verifiers | v1.0 | 2/2 | Complete | 2026-03-05 |
| 5. Phase Runner + Plan Verification | v1.0 | 3/3 | Complete | 2026-03-05 |
| 6. Pipeline Controller (Wave Model) | v1.0 | 4/4 | Complete | 2026-03-05 |
| 7. CLI + Git + Testing | v1.0 | 3/3 | Complete | 2026-03-05 |
| 8. Enhancement Layer | v1.0 | 4/4 | Complete | 2026-03-05 |
| 9. Flutter Verifier Infrastructure | v1.1 | 0/? | Not started | - |
| 10. Android Emulator Lifecycle | v1.1 | 0/? | Not started | - |
| 11. Maestro UAT Integration | v1.1 | 0/? | Not started | - |
| 12. iOS Simulator Support | v1.1 | 0/? | Not started | - |
