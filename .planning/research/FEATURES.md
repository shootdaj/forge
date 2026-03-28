# Feature Research

**Domain:** Flutter mobile app verification and UAT — Forge v1.1
**Researched:** 2026-03-28
**Confidence:** HIGH (Maestro and Flutter CI patterns well-documented in official sources), MEDIUM (some CI headless emulator automation patterns from community sources)

---

## Context

This document covers features for Forge v1.1: the ability to detect Flutter projects, verify they are healthy (build, analyze, test, emulator install), and run UAT via Maestro E2E flows. It does NOT revisit v1.0 features (web/API/CLI pipeline). The downstream consumer is the roadmap phase design; complexity and dependencies on existing Forge verifiers are called out explicitly.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any serious Flutter CI/verification system must include. Missing these means Forge cannot claim to support Flutter.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Flutter project detection | Before running any Flutter verifier, Forge must recognize the project is Flutter (not web/API/CLI). Standard CI systems (Codemagic, GitHub Actions) do this automatically from pubspec.yaml. | LOW | Parse pubspec.yaml for `flutter:` SDK dependency. Check presence of `android/`, `ios/` dirs. Extend existing `detectAppType()` in Forge. |
| `flutter pub get` verifier | Dependencies must resolve before any other check. Every Flutter CI pipeline starts here. Failure = unbuildable project. | LOW | Spawns `flutter pub get`, checks exit code 0. Existing verifier pattern (exit code + stdout) directly applicable. |
| `dart analyze` / `flutter analyze` clean | Static analysis is the #1 check every Flutter CI runs. Catches null-safety violations, unused imports, missing awaits. Official Flutter docs call this mandatory for every CI pipeline. | LOW | Spawn `flutter analyze`, exit code 0 = pass. Already a Forge verifier pattern for typecheck/lint. Directly analogous. |
| `flutter test` pass | Unit + widget tests must pass before any deployment. All Flutter CI pipelines enforce this. If tests fail, UAT is pointless. | LOW | Spawn `flutter test --no-pub`, parse exit code. Same pattern as existing test verifier (already parses test runner exit codes). |
| Debug build succeeds (`flutter build apk --debug`) | App must compile. Build failure = broken app. Every Flutter CI pipeline runs a build step. A debug build is sufficient for emulator-based UAT. | MEDIUM | Spawn `flutter build apk --debug` (Android) or `flutter build ios --debug --no-codesign` (iOS simulator). Check exit code and output artifact existence. |
| Emulator launch and app install | UAT requires the app to be running. Forge must be able to start an emulator (or detect one already running), install the debug APK, and confirm the app is ready. | HIGH | Use `flutter emulators --launch <id>`, wait for `adb wait-for-device`, then `flutter run -d <device>`. App-ready detection via stdout pattern ("Flutter run key commands" appears when app is listening). This is analogous to existing `startAppForUAT()` but mobile-specific. |
| Maestro flow execution | UAT for Flutter apps requires Maestro CLI. It is the standard tool for Flutter E2E testing (zero Dart code, YAML-based, semantics-tree aware). Equivalent to how Forge uses `agent-browser` for web UAT. | MEDIUM | Spawn `maestro test <flow.yaml>` against running app. Check exit code (0=pass, 1=fail). Optionally use `--format junit` for structured output. Maestro must be installed on host. |
| Maestro flow generation from requirements | Forge generates UAT flows for web apps by extracting user workflows from requirements. Same pattern needed for Flutter. Without generation, Forge cannot autonomously test Flutter apps. | HIGH | Agent SDK query() session: read requirements, output `.maestro/` YAML flow files per user workflow. Agent must know to use `tapOn`, `assertVisible`, `inputText`, `scrollUntilVisible`, `launchApp`. Existing `extractWorkflows()` pattern applies with mobile-specific prompt. |
| App-type detection update | Forge currently detects "web", "api", "cli". Flutter must be detected as "mobile" to route to mobile verifiers and mobile UAT instead of web/API paths. | LOW | Add `"mobile"` to app type enum. Detection: pubspec.yaml has `sdk: flutter` in environment, plus `flutter:` key in pubspec. Existing `detectAppType()` in `src/pipeline/` needs one new branch. |

### Differentiators (Competitive Advantage)

Features that make Forge's Flutter support meaningfully better than just running the CLI commands yourself.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Semantic identifier injection guidance | Maestro cannot target Flutter widgets by Key — only by text, semanticLabel, or Flutter 3.19+ semantic identifiers. If the agent building the app doesn't know this, all UAT flows will be brittle coordinate-based taps. Forge should include Semantics best practices in the context prompt for Flutter phases. | LOW | Add mobile-aware context prompt block: "wrap interactive widgets in Semantics with identifier property (Flutter 3.19+) so Maestro UAT can find them". No new code needed — just prompt engineering in `buildContextPrompt()`. |
| Maestro flow gap closure | When a Maestro flow fails, Forge should diagnose the failure (element not found, assertion failed, timing issue) and re-run the agent to fix the flow or the app. Same pattern as existing UAT gap closure, but Maestro exit codes + stderr are the signal. | MEDIUM | Extend existing `runUATWithGapClosure()` to handle Maestro output. Gap closure prompt must include the failed flow YAML + Maestro error output. Agent can fix the YAML flow OR fix the widget's semantics. |
| Android emulator lifecycle management | Forge should be able to detect if an emulator is already running, boot one if not, wait for readiness, run tests, and optionally shut down. Without this, Flutter UAT requires a human to pre-boot the emulator — defeating the autonomy goal. | HIGH | `flutter emulators` lists available AVDs. `adb devices` checks running state. `emulator -avd <name> -no-window &` starts headless. `adb wait-for-device && adb shell getprop sys.boot_completed` confirms readiness. This is the most operationally complex new piece in v1.1. |
| Flutter-specific deployment config checks | Android: verify `key.properties` exists and references a keystore, `applicationId` is not the default `com.example.*`, signing config is set in `build.gradle`. iOS: verify `ios/Runner/Info.plist` has the correct `CFBundleIdentifier`, not placeholder. These checks are analogous to existing `deploymentConfigVerifier` but mobile-specific. | MEDIUM | New `mobileDeploymentVerifier` that checks: `android/app/build.gradle` for `applicationId`, `android/key.properties` presence (or note if absent for debug-only use), `ios/Runner/Info.plist` `CFBundleIdentifier`. Fail with actionable message if still `com.example.*`. |
| Test pyramid enforcement for Flutter | Forge already enforces unit/widget/integration test pyramid for web projects. For Flutter, the layers map to: Dart unit tests (`test/` dir), Flutter widget tests (`testWidgets` calls), and Maestro E2E flows. Forge should verify all three layers exist, not just that `flutter test` passes. | MEDIUM | Extend coverage verifier: check `test/` dir for unit tests, check test files for `testWidgets` calls, check `.maestro/` dir for flow files. Each is a file-existence + content check — existing pattern. |
| Configurable "app-ready" signal detection | `flutter run` emits "Flutter run key commands" to stdout when the app is connected and ready to receive hot-reload commands. Forge must detect this signal to know when Maestro can begin. If this detection is missing, Maestro will try to interact with an app that isn't running yet. | MEDIUM | Add `flutterAppReadySignal` constant to mobile startup module. Scan stdout stream for this string before declaring app-ready. Timeout if not seen within N seconds. Analogous to web health check polling but stdout-based. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| iOS physical device testing | Complete testing would run on real iPhones, not just simulators. | iOS physical device testing requires Apple Developer certificates, provisioning profiles, Xcode, and a Mac with a connected device. This is a CI infrastructure problem, not a Forge problem. Forge cannot provision developer accounts. IDB (Facebook's iOS Device Bridge) adds complex setup. | Target iOS Simulator only for v1.1. iOS physical device support deferred to v1.2 or explicit per-project configuration. |
| Maestro Cloud integration | Maestro Cloud runs tests on real devices in the cloud, removing the local emulator requirement. | Maestro Cloud requires authentication tokens, billing, and network connectivity. It adds an external service dependency to the Forge pipeline — exactly the kind of thing the mock/real wave model is designed to isolate. | Use local emulator via `maestro test` in v1.1. Maestro Cloud is a future enhancement if teams need it. |
| `flutter build appbundle` / release signing for UAT | Teams want to test with production-like release builds. | Release signing requires keystores, key passwords, signing configs, and typically CI secrets management. UAT does not need a release build — a debug build on emulator is sufficient for functional verification. | Use `--debug` builds for all UAT. Forge should check deployment config exists but not actually build a signed release. |
| assertWithAI assertions in generated flows | Maestro's `assertWithAI` uses an LLM to validate visual states. It seems powerful for complex UI assertions. | `assertWithAI` defaults `optional: true` because it's experimental and unreliable enough to break CI. It adds external LLM API calls inside the Maestro run. For Forge-generated flows, deterministic assertions (`assertVisible`, `assertNotVisible`) are more reliable. | Use `assertVisible` / `assertNotVisible` for generated flows. `assertWithAI` can be manually added by users who need visual validation. |
| React Native support in v1.1 | Teams ask: "if you support Flutter, why not React Native too?" | React Native has different tooling (Metro bundler, Expo, `npx react-native run-android`), different test conventions, different emulator management. Treating them the same creates a bloated abstraction layer that works poorly for both. | Defer React Native to v1.2, per PROJECT.md. Nail Flutter first with a clean mobile abstraction. |
| Code coverage enforcement for Flutter in v1.1 | Coverage thresholds (lcov, 70%+) are standard in mature Flutter CI pipelines. | `flutter test --coverage` generates `coverage/lcov.info` which requires `lcov` to parse. The tooling is an optional extra step that adds complexity. More importantly, Forge-generated Flutter apps may not have high widget test coverage initially — enforcing a hard threshold will cause unnecessary failures. | Run `flutter test --coverage` and report the number, but do not fail on threshold in v1.1. Add threshold enforcement in v1.2 once Flutter support is stable. |

---

## Feature Dependencies

```
App Type Detection (mobile)
    └──required by──> Flutter Verifiers (build, analyze, test, pub get)
    └──required by──> Mobile UAT path
    └──required by──> Mobile Deployment Config Verifier

Flutter Pub Get Verifier
    └──required by──> Dart Analyze Verifier (can't analyze with unresolved deps)
    └──required by──> Flutter Test Verifier
    └──required by──> Flutter Build Verifier

Flutter Test Verifier
    └──required by──> Spec Compliance Loop (same as existing — test pass = requirement met)

Flutter Build Verifier (debug APK/IPA)
    └──required by──> Emulator Launch + App Install
    └──required by──> Maestro Flow Execution

Emulator Launch + App Install
    └──required by──> Maestro Flow Execution
    └──required by──> App-ready Signal Detection

Maestro Flow Generation (agent query())
    └──required by──> Maestro Flow Execution
    └──requires──> Requirements (REQUIREMENTS.md workflows)
    └──requires──> Semantic identifier guidance (context prompt)

Maestro Flow Execution
    └──required by──> UAT Gap Closure (mobile)
    └──depends on──> Emulator running
    └──depends on──> App installed and ready

Mobile Deployment Config Verifier
    └──enhances──> Deployment awareness (existing src/deployment/)
    └──independent──> (can run without emulator)

Semantic Identifier Guidance (context prompt)
    └──enhances──> Maestro Flow Execution reliability
    └──independent──> (prompt change only, no new code)
```

### Dependency Notes

- **Flutter pub get must run first:** `dart analyze`, `flutter test`, and `flutter build` all fail if `pub get` hasn't resolved dependencies. This is the first verifier in the mobile verification chain.
- **Build before emulator launch:** Maestro needs an installed APK on the device. The build verifier must produce the APK before the emulator launch step.
- **App-ready signal before Maestro:** Maestro will immediately fail with "element not found" if it starts before the Flutter app has connected to the device. The stdout-based readiness signal is the gate.
- **Semantic identifiers in app code:** If the app doesn't expose semantic identifiers, Maestro flows must fall back to text matching, which breaks on multi-language apps. The context prompt fix is a prerequisite for reliable flow generation.
- **Existing verifier infrastructure reused:** `dart analyze` = typecheck verifier pattern. `flutter test` = test verifier pattern. `flutter pub get` = dependency verifier. The mobile verifier chain reuses 80% of existing Forge verifier code — only emulator lifecycle and Maestro execution are genuinely new.

---

## MVP Definition

### Launch With (v1.1)

Minimum needed for Forge to build, verify, and UAT a Flutter mobile app end-to-end.

- [ ] **Flutter app type detection** — Without this, the entire mobile path is never invoked
- [ ] **`flutter pub get` verifier** — Foundation of all other Flutter checks
- [ ] **`flutter analyze` verifier** — Primary code quality gate; analogous to existing typecheck verifier
- [ ] **`flutter test` verifier** — Primary functional gate; analogous to existing test verifier
- [ ] **`flutter build apk --debug` verifier** — Required to produce artifact for emulator install
- [ ] **Emulator launch and app-ready detection** — Required before Maestro can run
- [ ] **Maestro flow generation from requirements** — Core of autonomous mobile UAT; without this, UAT is manual
- [ ] **Maestro flow execution and gap closure** — The UAT gate for mobile apps
- [ ] **Semantic identifier guidance in context prompt** — Required for reliable flow generation; LOW cost, HIGH impact

### Add After Validation (v1.1.x)

Features to add once a Flutter app has been built and tested end-to-end by Forge.

- [ ] **Mobile deployment config verifier** — Checks bundle ID, signing config. Add once basic pipeline works.
- [ ] **Test pyramid enforcement for Flutter** — Verify unit, widget, AND Maestro flows exist. Add once coverage patterns are understood.
- [ ] **iOS Simulator support** — iOS Simulator via `flutter build ios --debug --no-codesign` + `open -a Simulator`. Android first.
- [ ] **Flutter test coverage reporting** — `flutter test --coverage` + lcov parsing. Non-blocking in v1.1, enforceable in v1.2.

### Future Consideration (v2+)

- [ ] **Maestro Cloud integration** — Real-device testing on remote fleet; external service dependency
- [ ] **iOS physical device testing** — Requires Apple developer account, provisioning; infrastructure problem
- [ ] **React Native support** — Different toolchain entirely; v1.2 per roadmap
- [ ] **Visual regression testing** — Screenshot comparison across builds; needs baseline infrastructure
- [ ] **Coverage threshold enforcement** — Hard fail on <70% coverage; defer until Flutter support is stable

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Flutter app type detection | HIGH | LOW | P1 |
| `flutter pub get` verifier | HIGH | LOW | P1 |
| `flutter analyze` verifier | HIGH | LOW | P1 |
| `flutter test` verifier | HIGH | LOW | P1 |
| `flutter build apk --debug` verifier | HIGH | MEDIUM | P1 |
| App-ready signal detection | HIGH | MEDIUM | P1 |
| Emulator launch + management | HIGH | HIGH | P1 |
| Maestro flow generation | HIGH | HIGH | P1 |
| Maestro flow execution + gap closure | HIGH | MEDIUM | P1 |
| Semantic identifier context prompt | HIGH | LOW | P1 |
| Mobile deployment config verifier | MEDIUM | MEDIUM | P2 |
| Flutter test pyramid enforcement | MEDIUM | LOW | P2 |
| iOS Simulator support | MEDIUM | MEDIUM | P2 |
| Coverage reporting (non-blocking) | LOW | LOW | P2 |
| Maestro Cloud integration | LOW | HIGH | P3 |
| React Native support | LOW | HIGH | P3 |
| Visual regression testing | LOW | HIGH | P3 |

**Priority key:**
- P1: Required for Forge to build + verify + UAT a Flutter app autonomously
- P2: Quality improvements once basic pipeline is working
- P3: Future enhancements; not in v1.1 scope

---

## Maestro Capability Reference

What Maestro can do — relevant for knowing what UAT flows to generate.

### Interactions (HIGH confidence — official docs)
| Command | What It Does |
|---------|-------------|
| `launchApp` | Start the app (requires `appId`) |
| `stopApp` | Kill the running app |
| `tapOn` | Tap by text, semanticLabel, or semantic identifier |
| `doubleTapOn` | Double-tap |
| `inputText` | Type text into focused field |
| `eraseText` | Clear text in focused field |
| `swipe` | Directional swipe gesture |
| `scroll` | Scroll container |
| `scrollUntilVisible` | Scroll until element appears |
| `waitForAnimationToEnd` | Block until animations settle |
| `extendedWaitUntil` | Wait up to N seconds for condition |
| `assertVisible` | Assert element is visible (by text/id/label) |
| `assertNotVisible` | Assert element is absent |
| `assertTrue` | Assert arbitrary JavaScript condition |
| `takeScreenshot` | Capture screenshot to file |
| `runScript` | Execute JavaScript for complex logic |
| `setPermissions` | Grant/deny system permissions |
| `copyTextFrom` | Copy displayed text to variable |
| `pasteText` | Paste clipboard content |

### Network Mocking (MEDIUM confidence — community sources)
Maestro itself does not natively intercept HTTP. Network mocking requires running WireMock as a local HTTP proxy and configuring the Flutter app to point at it. This is too complex for Forge-generated flows in v1.1. Generated flows should test against real app behavior (or the app's own mock layer from Wave 1).

### Element Targeting (HIGH confidence — official docs)
Priority order Maestro uses when targeting Flutter elements:
1. Semantic `identifier` property (Flutter 3.19+ — most stable)
2. Text content displayed by widget
3. `semanticLabel` attribute
4. Coordinates (fragile — different screen sizes, avoid)

Widget `Key` values are NOT accessible to Maestro — they do not cross the accessibility bridge.

### Output and CI Integration (HIGH confidence — official docs)
- `maestro test <flow.yaml>` — run a single flow
- `maestro test <dir/>` — run all flows in directory
- `--format junit --output report.xml` — JUnit output for CI
- Exit code 0 = pass, 1 = any flow failed
- Live progress report in terminal during run

---

## Flutter Verification Sequence

The ordered verification sequence Forge should run for Flutter projects, showing which existing verifiers are reused vs. new:

```
1. flutter pub get          [NEW — but pattern identical to existing dep verifier]
2. dart analyze             [NEW — pattern identical to existing typecheck verifier]
3. flutter test --no-pub    [NEW — pattern identical to existing test verifier]
4. flutter build apk --debug [NEW — pattern identical to existing build/docker verifier]
5. emulator boot + adb ready [NEW — operationally novel, no existing analog]
6. flutter run -d <device>  [NEW — app startup, stdout-based ready detection]
7. maestro test .maestro/   [NEW — mobile UAT, analogous to agent-browser web UAT]
```

Steps 1-4 map directly onto existing Forge verifier patterns (exit code + stdout parsing). Steps 5-7 are genuinely novel mobile operations.

---

## Common Flutter UAT Patterns (What Teams Actually Test)

Patterns derived from Maestro community usage and official examples — these are the workflows Forge should prioritize generating from requirements:

| Flow Type | Typical Steps | Complexity |
|-----------|---------------|------------|
| Authentication (login/logout) | launchApp → tapOn email field → inputText → tapOn password → inputText → tapOn login button → assertVisible welcome screen | LOW |
| Onboarding (first-run wizard) | launchApp → assertVisible onboarding screen → tapOn next → tapOn next → tapOn "Get Started" → assertVisible main screen | LOW |
| Navigation (bottom nav / drawer) | launchApp → tapOn tab/menu item → assertVisible expected screen → tapOn back → assertVisible previous screen | LOW |
| Form submission (create/edit) | launchApp → navigate to form → tapOn field → inputText value → tapOn save → assertVisible success message → assertVisible new item in list | MEDIUM |
| List interaction (scroll + tap) | launchApp → scrollUntilVisible target item → tapOn item → assertVisible detail screen → tapOn back | MEDIUM |
| Permission grant | launchApp → trigger permission request → setPermissions (camera/location/notifications) → assertVisible permission-dependent feature | MEDIUM |
| Error state handling | launchApp → trigger action that fails → assertVisible error message → tapOn retry → assertVisible success | MEDIUM |

These map directly to what `extractWorkflows()` should produce from a requirements document — one Maestro YAML flow per user workflow.

---

## Sources

- [Maestro Flutter Support — Official Docs](https://docs.maestro.dev/get-started/supported-platform/flutter) (HIGH confidence — official)
- [Maestro CLI Commands Reference](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) (HIGH confidence — official)
- [Flutter Testing Overview — Official Docs](https://docs.flutter.dev/testing/overview) (HIGH confidence — official)
- [Flutter Android Deployment — Official Docs](https://docs.flutter.dev/deployment/android) (HIGH confidence — official)
- [Flutter iOS Deployment — Official Docs](https://docs.flutter.dev/deployment/ios) (HIGH confidence — official)
- [Maestro E2E UI Testing Article](https://maestro.dev/insights/end-to-end-ui-testing-for-mobile-apps-with-maestro) (HIGH confidence — official blog)
- [Flutter CI/CD with Codemagic — FreeCodeCamp](https://www.freecodecamp.org/news/build-a-complete-flutter-ci-cd-pipeline-with-codemagic/) (MEDIUM confidence — tutorial)
- [Maestro WireMock Network Mocking Guide](https://maestro.dev/blog/guide-to-maestro-ui-testing-with-api-mocking-using-wiremock) (MEDIUM confidence — official blog)
- [Flutter E2E testing community discussion](https://forum.itsallwidgets.com/t/e2e-testing-tools-patrol-vs-maestro-vs-appium-what-do-you-use/4034) (MEDIUM confidence — community)
- [Test Automation with Maestro and Flutter — Medium](https://medium.com/@j.chatkevicius/test-automation-with-maestro-and-flutter-676046b9d127) (MEDIUM confidence — community)
- [Maestro assertWithAI — Official Docs](https://docs.maestro.dev/reference/commands-available/assertwithai) (HIGH confidence — official)

---

*Feature research for: Flutter mobile app verification and UAT — Forge v1.1*
*Researched: 2026-03-28*
