# Pitfalls Research

**Domain:** Adding Flutter mobile verification and UAT to an existing Node.js/TypeScript build orchestrator (Forge v1.1)
**Researched:** 2026-03-28
**Confidence:** HIGH (official Flutter/Dart docs, Maestro issue tracker, Android/iOS developer docs, GitHub issue analysis)

---

## Critical Pitfalls

### Pitfall 1: Flutter Startup Lock Blocks Parallel Builds

**What goes wrong:**
Flutter uses a global file-based startup lock (`~/.flutter` or the SDK cache directory). If Forge ever fires two Flutter CLI commands (e.g., `flutter analyze` and `flutter build apk`) concurrently — even in separate phases — the second command hangs indefinitely printing "Waiting for another flutter command to release the startup lock..." This is a complete deadlock that requires killing the orphaned process and deleting the lock file manually.

**Why it happens:**
The Flutter toolchain is not designed for parallel execution. The startup lock is a single global resource shared across all invocations on the machine. Forge's existing pipeline runs verifiers in parallel (`Promise.all`) and may trigger concurrent Flutter CLI calls if the verifier runner is not gated.

**How to avoid:**
- Serialize all Flutter CLI invocations with a process-level mutex in the new `flutter-verifier.ts`. No two Flutter commands may run simultaneously.
- If running multiple Flutter commands in sequence (analyze → build → test), pipe them as a single shell chain or a sequential awaited function — never `Promise.all`.
- Add detection: if stdout contains "Waiting for another flutter command" kill the process and surface it as a verifier error, not a hang.

**Warning signs:**
- Forge hangs after starting a verifier with no new output for >30 seconds.
- `ps aux | grep flutter` shows multiple Flutter processes in state `S+` (sleeping).
- Timeout kills are needed regularly.

**Phase to address:**
Flutter verifier implementation (Phase 1 of v1.1). The serialization constraint must be baked in from day one — it cannot be retrofitted after the verifiers are used in parallel contexts.

---

### Pitfall 2: Android Emulator Startup Takes 3-5 Minutes and Fails Silently

**What goes wrong:**
The Android emulator (QEMU-backed AVD) takes 2-5 minutes to reach a usable state on a cold start. `emulator @MyAVD` returns immediately — the process is running, but the device is not ready. Polling `adb devices` shows the device, but `adb shell getprop sys.boot_completed` returns "0" for minutes. If Forge starts running Maestro flows or `flutter run` before boot completes, tests get mysterious "device not found" or "Activity not found" errors that look like app bugs.

**Why it happens:**
The emulator binary starts the QEMU guest asynchronously. There is no synchronous "emulator ready" signal from the process itself — you must poll ADB. Forge's existing health-check model (`curl -sf <url>`) does not translate to the mobile world where the "health signal" is an ADB property.

**How to avoid:**
- Boot wait loop: poll `adb -s <device_serial> shell getprop sys.boot_completed` every 3 seconds with a 5-minute total timeout. Only proceed when value is `"1"`.
- Additionally check `adb -s <device_serial> shell pm path android` to confirm package manager is initialized (boot_completed can flip before all services are up).
- Use `emulator -no-window -no-audio -gpu swiftshader_indirect` for headless execution — never assume a display is available in CI.
- Always record the emulator PID and serial at startup; store in Forge state so cleanup can target the right process.
- Never use `adb wait-for-device` alone — it fires when USB is connected, not when boot completes.

**Warning signs:**
- Tests fail with "device not found" errors that resolve on manual retry minutes later.
- Maestro reports "app not launched" on first run but succeeds on second.
- ADB shows device but `sys.boot_completed` is `0` during test execution.

**Phase to address:**
Emulator lifecycle management (Phase 1 of v1.1, emulator manager). Boot wait is the most fundamental piece of mobile testing infrastructure — without it nothing else works reliably.

---

### Pitfall 3: Emulator Resource Leak on Test Failure

**What goes wrong:**
If a verifier, build step, or UAT run throws an exception before cleanup, the emulator process stays alive. On the next Forge run (or resume), a second emulator is started. Two emulators compete for ADB. After 3-4 runs, the machine has 4 AVD processes consuming 8-12GB RAM and 6-8 CPU cores, making every subsequent run progressively slower until the machine OOMs. The emulators are invisible to Forge because their PIDs are no longer tracked in state.

**Why it happens:**
Forge's existing cleanup model relies on `try/finally` around Docker compose (`stopApplication`). The same pattern doesn't automatically apply to a spawned emulator process because the emulator is a long-lived subprocess started at the beginning of the mobile UAT phase — not a Docker container with a clean teardown command.

**How to avoid:**
- Always start the emulator inside a `try/finally` block in TypeScript. The `finally` must call `adb -s <serial> emu kill` or `kill <pid>` regardless of whether tests passed or threw.
- Register a `process.on('exit')` handler in the emulator manager that kills all tracked emulators, so even a SIGKILL scenario gets best-effort cleanup.
- On startup, enumerate existing emulators via `adb devices | grep emulator` and kill any that are NOT tracked in forge-state. This cleans up leaks from previous crashed runs.
- Store emulator PIDs and ADB serials in `forge-state.json` under a `activeEmulators` key so resume/cleanup can target them precisely.

**Warning signs:**
- `adb devices` lists more emulators than Forge started.
- Machine RAM steadily rising across test runs.
- `ps aux | grep emulator` shows processes with long uptime from previous sessions.

**Phase to address:**
Emulator lifecycle management (Phase 1 of v1.1). Cleanup must be implemented simultaneously with startup — never add startup without cleanup.

---

### Pitfall 4: `flutter test --machine` JSON Output is Contaminated by Gradle Output

**What goes wrong:**
When running `flutter test integration_test --reporter json` (or `--machine`), Flutter on Android emits Gradle build progress lines (e.g., "Running Gradle task 'assembleDebug'... 6.8s") directly into the same stdout stream as the JSON test events. Standard JSON.parse on the full output fails with a parse error. Forge's existing `testsVerifier` assumes each line of the output is parseable JSON — this assumption breaks completely for Flutter integration tests.

**Why it happens:**
`flutter test` wraps `dart test` but also drives the Android build toolchain. Gradle does not respect the JSON reporter flag and writes its progress to stdout regardless. This is a known upstream bug (flutter/flutter#123873) with no fix planned — the workaround must be in the consumer.

**How to avoid:**
- Filter the test output stream: only parse lines that start with `{` as JSON events. Drop all other lines.
- Use the Dart test JSON reporter protocol (not `--machine`): `flutter test --reporter json`. Parse each `{...}` line as a separate event object.
- Interpret results from the final `DoneEvent` (type `"done"`) which has `success: true/false`. Do NOT rely on exit code alone — `flutter test` can exit 0 with failures if the reporter misreports.
- Cross-check: `success: false` in DoneEvent OR any `TestDoneEvent` with `result: "failure"` or `result: "error"` constitutes a failing suite.

**Warning signs:**
- JSON.parse throws on the raw output of `flutter test`.
- Verifier reports parse error instead of actual test results.
- `numPassedTests === 0` even when tests ran (parser skipped all events).

**Phase to address:**
Flutter test verifier (Phase 1 of v1.1). The JSON parsing layer must handle multi-format contaminated output from the start — treat this as a design constraint, not an edge case.

---

### Pitfall 5: Maestro Animation Flakiness — Tap After Navigation Transition Fails

**What goes wrong:**
Maestro flows that tap a button immediately after a screen navigation (e.g., pushing a new route in Flutter Navigator) fail intermittently. The element is found by Maestro (accessibility tree shows it) but the tap does not register because the Flutter rendering engine is still mid-animation. The element is present but its position is changing. Depending on timing, the tap hits the old screen or a transitioning element. Maestro does not automatically detect this — it reports the interaction as completed and then the subsequent assertion fails. Failure rates of 20-30% per flow are common.

**Why it happens:**
Flutter's Navigator animations (hero, slide, fade) run on the UI thread and take 200-400ms by default. Maestro's "wait for element" heuristic detects when an element enters the accessibility tree but does not wait for the element's position to stabilize. The `waitForAnimationToEnd` modifier in Maestro improves this but is not applied automatically. The issue is marked "not planned" upstream (Maestro issue #1703).

**How to avoid:**
- Generate Maestro flows with `waitForAnimationToEnd: true` as a default after every `tapOn` that triggers a navigation.
- Alternatively, instruct the agent to build the Flutter app with `debugDisableAnimations: true` in test mode (via `FlutterTest.binding.debugDisableAnimations`), which disables animation entirely for test builds.
- Prefer `assertVisible` over `tapOn` to verify navigation completed before interacting with the new screen.
- In the Maestro flow generator prompt, always include: "After any navigation action, add a `waitForAnimationToEnd` command before asserting elements on the new screen."

**Warning signs:**
- Maestro test suite passes 70-80% of the time but not 100%.
- Failures cluster on tests that navigate between screens.
- Maestro logs show the expected element was found but the subsequent assertion fails.

**Phase to address:**
Mobile UAT via Maestro (Phase 2 of v1.1). The flow generator prompt must include animation-awareness instructions. Do not allow the agent to generate flows that tap immediately after navigation without explicit wait.

---

### Pitfall 6: Emulator Requires KVM/Hardware Acceleration — Unavailable in Most Docker/CI Environments

**What goes wrong:**
The Android emulator needs hardware virtualization (KVM on Linux, HAXM on macOS, Hyper-V on Windows) to run at usable speed. Without it, the emulator falls back to software TCG emulation, which is 8-12x slower — a "booting" state can take 20+ minutes and tests that normally take 30 seconds take 10 minutes. In Docker-based CI (standard containers, GitHub Actions free tier, most cloud CI systems), nested virtualization is blocked entirely and the emulator either fails to start or is unusably slow.

**Why it happens:**
Forge's existing pipeline makes no distinction between "can run Docker" and "can run Android emulator." Docker is universally available; KVM is not. The agent building a Flutter app will assume emulator testing is straightforward when it is not.

**How to avoid:**
- Gate emulator-based verification on a pre-flight check: `kvm-ok` (Linux) or check that `/dev/kvm` exists and is readable. If KVM is absent, log a clear warning and skip emulator-based steps, reporting them as "skipped (no hardware acceleration)" rather than failing.
- Document the requirement in the forge.config.json Flutter configuration: `emulator.requiresKvm: true` (default).
- For macOS CI (local developer machines), macOS has native hypervisor support and works well. For Linux CI, require `--nested-virtualization` capable runner (GitHub Actions larger runners, AWS bare-metal instances).
- Offer an iOS simulator path as a fallback for macOS environments where Android KVM is unavailable.

**Warning signs:**
- Emulator starts but `adb devices` shows the device as `offline` for >5 minutes.
- Build logs show "WARNING: Software fallback has been enabled" from QEMU.
- Boot takes >10 minutes.

**Phase to address:**
Emulator lifecycle management AND verifier capability detection (Phase 1 of v1.1). Add a `canRunEmulator()` pre-flight function that checks for virtualization support before ever attempting emulator launch.

---

### Pitfall 7: `flutter analyze` / `dart analyze` Exit Code Does Not Capture Warnings by Default

**What goes wrong:**
`flutter analyze` exits 0 (success) when the project has warnings and info-level issues, but no errors. An orchestrator that treats exit code 0 as "analyze passed" will ship code with dozens of lint warnings, deprecated API usages, or null-safety violations. Conversely, without `--no-fatal-infos`, `dart analyze` exits 1 on TODO comments, causing every build to fail on trivial noise.

**Why it happens:**
Dart's analyzer has three severity levels: error (always fatal), warning (fatal by default in `dart analyze`, but configurable), and info (not fatal by default). The behavior differs between `dart analyze` and `flutter analyze` — `flutter analyze` uses `--no-fatal-infos` automatically, but `dart analyze` does not. Forge's verifier must be explicit about which flags to use.

**How to avoid:**
- Run `flutter analyze --no-fatal-infos` (recommended default): exits 0 only when there are no errors and no warnings, but ignores info/hint messages.
- Parse the stdout output to extract the summary line: "No issues found!" vs. "N issues found." Exit code alone is insufficient — a bug in older Dart versions caused exit 0 on warnings.
- Warn (but do not fail) on info-level issues by parsing the count from stdout: if the summary contains a count > 0, include it in the verifier details.
- Respect the project's `analysis_options.yaml` — do not override it with additional flags unless the project explicitly opts in.

**Warning signs:**
- `flutter analyze` passes but `flutter build apk` fails with type errors (analyze was not strict enough).
- CI passes but code review reveals dozens of warnings (exit code masking).
- `dart analyze` fails on every PR due to TODO comments (using `--fatal-infos` accidentally).

**Phase to address:**
Flutter analyze verifier (Phase 1 of v1.1). The verifier must use `--no-fatal-infos` by default and parse the summary line, not just the exit code.

---

### Pitfall 8: Gradle Daemon Java Version Mismatch Causes Silent Build Corruption

**What goes wrong:**
Flutter's Android build toolchain requires specific Java/Gradle version combinations. When the system has multiple Java versions (e.g., Java 11 from a legacy project and Java 17 from a new one), the Gradle daemon started by one project can be reused by another project that expects a different Java version. The error is: "The newly created daemon process has a different context than expected. Context mismatch: Java home is different." The build either fails with a cryptic error or — worse — succeeds but produces a corrupted APK.

**Why it happens:**
Gradle's daemon reuse policy matches based on Gradle version and JVM arguments, but not strictly on Java home path in all versions. On a developer machine with multiple projects, this is a constant source of confusion. In Forge's context, if Forge itself runs in a different JVM than the Flutter project expects, the daemon inherits the wrong Java.

**How to avoid:**
- Always run `flutter build` with `--dart-define=...` and a clean environment: set `JAVA_HOME` explicitly to the Java version the project requires before spawning the build process.
- Use `flutter clean` before the first build in a new Forge pipeline to invalidate stale Gradle daemon state.
- In the build verifier, check `flutter doctor -v` output for "Android toolchain" and "Java" version compatibility before attempting a build.
- Treat any build failure containing "daemon" or "java home" in the error message as a toolchain configuration error, not an application bug — surface it with clear remediation instructions.

**Warning signs:**
- `flutter build apk` fails with "daemon process has a different context."
- Builds succeed locally but fail on the CI agent (different Java version).
- Gradle wrapper downloads a new distribution even though it was cached (version mismatch).

**Phase to address:**
Flutter build verifier (Phase 1 of v1.1). The build step must set `JAVA_HOME` explicitly and run `flutter doctor` as a pre-flight check.

---

### Pitfall 9: CocoaPods Cache Staleness Breaks iOS Builds

**What goes wrong:**
On macOS, Flutter's iOS build requires CocoaPods to resolve native dependencies. After a `flutter pub get` that changes native dependencies, the `ios/Pods` directory and `ios/Podfile.lock` become stale. Running `flutter build ios` fails with errors like "CocoaPods's specs repository is too out-of-date to satisfy dependencies" or mismatched `PODS_ROOT`. This is not caught by `flutter doctor` and the error messages are opaque.

**Why it happens:**
CocoaPods has a separate cache layer (`~/.cocoapods/repos/`) that tracks spec repository state. When Flutter adds a new plugin with iOS native code, CocoaPods must fetch the spec from the repository. If the local specs repo is stale (>7 days old or never initialized), pod install fails. In CI environments where the CocoaPods cache is not preserved, this is a cold-start failure on every run.

**How to avoid:**
- Before running `flutter build ios`, check if `ios/Pods/Manifest.lock` matches `ios/Podfile.lock`. If they differ, run `cd ios && pod install` explicitly.
- Cache `~/.cocoapods/repos/` in CI to avoid fetching the full spec repo (250MB+) on every run.
- If pod install fails, run `pod repo update` and retry once before failing.
- For the Forge build verifier, treat any iOS build failure mentioning "Pods" or "CocoaPods" as a dependency resolution error, not an application error.

**Warning signs:**
- iOS build fails but Android build succeeds on the same code.
- Error contains "CocoaPods out of date" or "Podfile.lock out of date."
- CI iOS builds consistently take 5+ minutes longer than expected (downloading the specs repo every time).

**Phase to address:**
Flutter build verifier (Phase 1 of v1.1, iOS path). Add a pre-build `pod install` check to the iOS build step. Document the CocoaPods cache requirement for CI environments.

---

### Pitfall 10: Maestro `--format junit` Flag Causes False Failures (Regression Bug)

**What goes wrong:**
In Maestro 2.0.x, using `--format junit` causes `maestro test` to report test failure even when all individual flows pass. The JUnit XML file is generated correctly but the process exit code is 1. The inverse is also true: in some configurations, Maestro exits 0 but writes a JUnit XML that shows failures. If Forge trusts exit code alone or the JUnit file alone, it gets the wrong answer.

**Why it happens:**
Maestro's format flag handling has had multiple regressions. The `--format` flag triggers additional output processing that can throw exceptions after all flows have completed, causing a non-zero exit code that doesn't represent actual test results. This is a known regression (Maestro issue #2706) reported in 2024 and intermittently fixed/broken across patch versions.

**How to avoid:**
- Run `maestro test` WITHOUT `--format junit`. Parse Maestro's default stdout output for pass/fail signals instead.
- Alternatively, use `maestro test --format junit --output results.xml` and then verify BOTH: exit code AND the JUnit XML content. If they disagree, trust the JUnit XML (it is written by the test execution path, not the reporting path).
- Parse the JUnit XML for `<testsuite failures="0" errors="0">` rather than relying on the exit code as the sole truth signal.
- Pin the Maestro CLI version in the project's toolchain: use `maestro --version` output to detect version before running. Avoid using whatever `maestro` happens to be on PATH.

**Warning signs:**
- Maestro logs show "Flow Completed" for all flows but the process exits 1.
- CI shows red but the test output shows all flows passed.
- JUnit XML exists and shows 0 failures but Forge marks the UAT step as failed.

**Phase to address:**
Mobile UAT via Maestro (Phase 2 of v1.1). The Maestro result interpreter must use defense-in-depth: check both exit code and output content, and prefer content when they conflict.

---

### Pitfall 11: `flutter run` Does Not Exit — It Is a Long-Running Process

**What goes wrong:**
Forge's existing pipeline treats all build/verify commands as processes that run and exit. `flutter run` is fundamentally different: it starts the app on the emulator and then holds the terminal open, forwarding logs and handling hot reload. If Forge starts `flutter run` as a regular `execWithTimeout` call expecting it to exit, it will either (a) hang forever, (b) be killed by the timeout before Maestro can run, or (c) kill the app before tests complete.

**Why it happens:**
The UAT for web apps uses Docker as a long-lived background process, and Forge has `startApplication`/`stopApplication` lifecycle methods. Mobile UAT requires the same pattern but with `flutter run` instead of Docker. The distinction between "start" (non-blocking) and "wait for ready" and "stop" must be explicit.

**How to avoid:**
- Use Node.js `child_process.spawn()` (not `exec`) to start `flutter run` as a detached background process. Capture its PID and ADB device serial.
- Wait for the "Flutter run key commands" line in stdout — this indicates the app is running and ready. Do NOT proceed until this line appears (with a 3-minute timeout).
- After Maestro tests complete, explicitly kill the `flutter run` process by PID. Do not rely on process.exit or SIGTERM propagation.
- Store the `flutter run` PID in `forge-state.json` so it can be killed on resume after crash.
- Important: `flutter run` output includes both the VM service URL (used by Maestro for some interactions) and the device output log. Capture both streams.

**Warning signs:**
- Maestro tests start before the app is ready, immediately failing with "App not found."
- After UAT, the Forge process hangs (flutter run is still running).
- After a crash-resume, there is a zombie `flutter run` process that blocks the new emulator session.

**Phase to address:**
Mobile UAT lifecycle management (Phase 2 of v1.1). This requires a dedicated `MobileAppRunner` class analogous to Forge's `startApplication`/`stopApplication` pair, but for the `flutter run` long-lived process model.

---

### Pitfall 12: Headless Android Emulator Loses Window Focus — Maestro UI Interaction Fails

**What goes wrong:**
In headless CI (no display server), Android emulators run with `-no-window`. Some Maestro accessibility service operations fail when the emulator lacks an active window focus. Specifically, Maestro issues like #2750 document: "Cannot verify accessibility service flags," "Active window root not found," and "Could not detect idle state" — all from running headless. Flows work locally (with a window) but fail consistently in CI (without).

**Why it happens:**
Android's accessibility framework has edge cases in windowless mode. Maestro's UIAutomator-based element detection relies on the accessibility service reading the active window's root view hierarchy. In headless mode, when `launchApp` / `killApp` sequences are used (as Maestro UAT flows typically do), the window manager loses track of the active window between launches.

**How to avoid:**
- Use `-gpu swiftshader_indirect` (software rendering without a real GPU) combined with `-no-window` instead of `-gpu off` — `swiftshader_indirect` maintains a proper graphics context that the accessibility framework can use.
- Avoid `killApp` + `launchApp` sequences in Maestro flows. Instead, use `clearState: true` in the app launch configuration to reset state without killing and relaunching.
- If `launchApp`/`killApp` sequences are unavoidable, add a 3-5 second sleep between kill and relaunch to allow the window manager to reset.
- For flows that must run in CI, test them headlessly locally first using `emulator -no-window` before claiming they work.

**Warning signs:**
- Tests pass 100% locally but fail 30-60% of the time in CI.
- Maestro logs contain "Active window root not found" or "accessibility service flags."
- Failures are more common on the second or third flow in a multi-flow test suite.

**Phase to address:**
Emulator lifecycle management AND Maestro flow template (Phase 1 and Phase 2 of v1.1). The emulator startup configuration must use `swiftshader_indirect`. The flow template generator must avoid kill/relaunch patterns.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Trust exit code only for `flutter test` | Simpler parser | Misses Gradle-contaminated JSON; exit 0 can mask failures | Never — parse JSON events |
| Trust exit code only for `maestro test` | Simpler result check | `--format junit` regression causes false failures | Never — check output content too |
| Start emulator without boot wait | Faster test start | Maestro finds no app, tests fail nondeterministically | Never — always wait for `sys.boot_completed` |
| Skip emulator cleanup on test failure | Simpler code | Machine OOMs after 3-4 failed runs | Never — always cleanup in finally |
| Use `dart analyze` without `--no-fatal-infos` | Stricter default | Fails on TODO comments, blocks every PR | Only if project has zero info-level issues (rare) |
| Skip KVM availability check | Less pre-flight code | Emulator silently degrades to 12x slower mode | Never — check KVM before attempting emulator |
| Run `flutter run` with `exec` instead of `spawn` | Less code | Hangs forever; UAT never starts | Never — `flutter run` is a daemon, use `spawn` |
| Hardcode emulator serial `emulator-5554` | Less state tracking | Breaks when two emulators are running | Never — capture serial dynamically from `adb devices` |

## Integration Gotchas

Common mistakes when integrating Flutter tooling into a Node.js orchestrator.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `flutter test --reporter json` | Parse all lines as JSON | Filter for lines starting with `{`; Gradle output contaminates the stream |
| `adb devices` output | Assume first line is the device | Parse each line; filter for `emulator-XXXX\tdevice` (status must be `device`, not `offline`) |
| `maestro test` result | Trust exit code as single truth | Check exit code AND stdout for "Flow Completed" / "Flow Failed" counts |
| `flutter build apk` | Run concurrently with other Flutter commands | Serialize all Flutter CLI calls behind a mutex — the startup lock is global |
| `flutter run` process | Use `execSync` or `exec` | Use `child_process.spawn()`, capture stdout stream, wait for "key commands" line |
| Emulator boot readiness | Check `adb devices` status | Poll `adb shell getprop sys.boot_completed` until `"1"`; `adb devices` shows `online` before boot completes |
| iOS simulator readiness | Run immediately after `xcrun simctl boot` | Poll `xcrun simctl list devices` until status is `Booted`; add extra 5s for SpringBoard |
| CocoaPods on iOS | Run `flutter build ios` directly | Pre-check `ios/Pods/Manifest.lock` vs `ios/Podfile.lock`; run `pod install` if they differ |
| `dart analyze` severity | Treat exit 0 as "clean" | Parse stdout summary line — exit 0 with warnings is possible in some configurations |
| Maestro `--format junit` | Use it for structured CI output | Run without format flag OR verify BOTH exit code and XML content; they can disagree |

## Performance Traps

Patterns that work at small scale but fail as project complexity grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Cold-start emulator per verifier run | Each verification takes 5+ minutes | Cache warm emulator between verifier cycles; only restart on explicit reset | Any pipeline with >2 verify cycles |
| `flutter clean` before every build | Clean build from scratch is always 3-5 minutes | Only clean when explicitly requested or when toolchain version changes | Any pipeline with >1 build step |
| Running `pod install` before every iOS build | 2-3 minute overhead per build | Only run if `Podfile.lock` differs from `Pods/Manifest.lock` | Any iOS pipeline with >1 build step |
| Full `dart pub get` on every step | Unnecessary network calls, lock file thrashing | Run only at pipeline start or when `pubspec.yaml` changes | Any pipeline with >3 steps per phase |
| Starting a new emulator for unit tests | 3-5 minute startup for tests that don't need an emulator | `flutter test` (unit) runs on host machine; only integration tests need emulator | Every pipeline — unit tests never need emulator |

## Security Mistakes

Domain-specific security issues for mobile app orchestration.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing real API keys to `flutter run` in emulator | Keys in ADB logcat, accessible via `adb logcat` from any process with ADB access | Use test/mock credentials for emulator-based UAT; never pass production keys |
| Using real device over USB in CI | Physical device can be compromised, data exfiltrated | CI must always use emulators, not physical devices; real device testing is developer-only |
| Maestro flows that create real accounts/emails | Flows may touch production if `.env.test` is not properly scoped | Maestro flows must use the same safety guardrail pattern as Forge's existing UAT safety prompt |
| Leaving emulator running after pipeline | ADB accessible to any local process; emulator may have app data | Always kill emulator at pipeline end; emulator data is not encrypted |

## UX Pitfalls

User experience issues specific to Flutter mobile verification in Forge.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Emulator starting..." with no progress indication | User doesn't know if it's 30s or 5 minutes away from ready | Show elapsed time and current boot phase ("booting...", "package manager ready...", "app installed...") |
| Generic "flutter test failed" without test names | Developer can't identify which test broke | Parse `TestDoneEvent` with `result: "failure"` and extract test name from `TestStartEvent` by matching `testID` |
| Silent emulator KVM fallback | User gets slow runs without understanding why | Log explicit warning: "WARNING: KVM unavailable — emulator running in software mode (8-12x slower)" |
| Maestro flow failures without screenshot | Developer can't see what the UI looked like | Maestro captures screenshots on failure in `~/.maestro/tests/`; always surface the path in the failure message |
| `flutter analyze` info flood | Developer dismisses all analyzer output | Surface only errors and warnings; show info count separately ("3 errors, 0 warnings, 45 hints (suppressed)") |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Emulator startup:** Starts the emulator process — verify it also waits for `sys.boot_completed=1` AND package manager readiness before running any subsequent step
- [ ] **Emulator teardown:** Has a cleanup call — verify it is in a `finally` block AND in a `process.on('exit')` handler AND scans for orphans from previous crashed runs
- [ ] **`flutter test` verifier:** Parses JSON output — verify it filters non-JSON lines (Gradle output), reads `DoneEvent.success`, and checks for any `TestDoneEvent` with `result != "success"`
- [ ] **`flutter analyze` verifier:** Checks exit code — verify it also parses the summary line for issue count and uses `--no-fatal-infos` flag
- [ ] **Maestro UAT runner:** Runs `maestro test` and checks exit code — verify it also reads stdout for flow pass/fail counts and handles the `--format junit` regression
- [ ] **`flutter run` process management:** Starts the app — verify it uses `spawn` (not `exec`), waits for "key commands" in stdout, stores the PID, and kills it in a `finally` block
- [ ] **KVM pre-flight check:** Checks for `/dev/kvm` existence — verify it also checks read permissions (`access('/dev/kvm', fs.constants.R_OK)`) and gracefully skips emulator steps if absent
- [ ] **Flutter startup lock:** Serializes Flutter CLI calls — verify no two `flutter` commands can run concurrently from Forge even across parallel verifiers
- [ ] **CocoaPods pre-check (iOS):** Detects stale Pods — verify it compares `Pods/Manifest.lock` to `Podfile.lock` and runs `pod install` only when they differ, not unconditionally
- [ ] **Emulator serial tracking:** Records the ADB serial — verify the serial is captured dynamically from `adb devices` output, not hardcoded to `emulator-5554`

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Flutter startup lock deadlock | LOW | Kill all `flutter` processes (`pkill -f flutter`), delete `~/.flutter/...lock` file, re-run |
| Emulator resource leak (multiple zombies) | LOW | Run `adb devices | grep emulator | awk '{print $1}' | xargs -I{} adb -s {} emu kill`, then resume |
| Gradle Java version mismatch | LOW-MEDIUM | Set `JAVA_HOME` to the correct JDK, run `flutter clean`, re-run build |
| CocoaPods stale cache | LOW | Run `cd ios && pod repo update && pod install`, re-run iOS build |
| Maestro animation flakiness (intermittent) | LOW | Retry the failed flows (they are inherently flaky); add `waitForAnimationToEnd` to the specific steps |
| Headless emulator accessibility failure | MEDIUM | Switch to `-gpu swiftshader_indirect`, avoid kill/relaunch sequences, re-run flows |
| `flutter run` zombie process blocks next run | LOW | Kill by stored PID or scan `ps aux | grep "flutter run"` and kill; delete stale emulator entry from state |
| Maestro `--format junit` false failure | LOW | Re-run without `--format` flag, parse stdout directly |

## Pitfall-to-Phase Mapping

How v1.1 roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Flutter startup lock | Phase 1: Flutter verifier infrastructure | Unit test: verify mutex prevents concurrent Flutter calls |
| Emulator startup timing | Phase 1: Emulator lifecycle manager | Integration test: start emulator, assert `boot_completed=1` before proceeding |
| Emulator resource leak | Phase 1: Emulator lifecycle manager | Test: kill Forge mid-emulator, verify cleanup runs on next start |
| JSON contamination from Gradle | Phase 1: Flutter test verifier | Unit test: feed mixed Gradle+JSON output, verify correct parse |
| Maestro animation flakiness | Phase 2: Mobile UAT / flow generation | Scenario test: run multi-screen flow, assert pass rate is deterministic |
| KVM unavailability | Phase 1: Emulator pre-flight check | Unit test: mock no-KVM environment, verify graceful skip |
| `dart analyze` exit code ambiguity | Phase 1: Flutter analyze verifier | Unit test: provide output with warnings, verify verifier detects them |
| Gradle Java mismatch | Phase 1: Flutter build verifier | Unit test: simulate `flutter doctor` output with mismatch, verify error surface |
| CocoaPods staleness | Phase 1: Flutter build verifier (iOS) | Integration test: stale Pods directory, verify pod install is triggered |
| Maestro format flag regression | Phase 2: Mobile UAT result parser | Unit test: parse stdout for flow counts independent of exit code |
| `flutter run` daemon model | Phase 2: Mobile app lifecycle | Integration test: verify spawn returns before app ready, app ready signal detected |
| Headless window focus loss | Phase 1: Emulator config AND Phase 2: flow templates | Scenario test: run kill/relaunch flow headlessly, verify no accessibility errors |

## Sources

- [flutter/flutter#123873 — Gradle output contaminating JSON reporter](https://github.com/flutter/flutter/issues/123873) — Confirmed contamination and jq workaround (HIGH confidence)
- [flutter/flutter#16423 — Flutter startup lock](https://github.com/flutter/flutter/issues/16423) — Confirmed global lock, sequential execution required (HIGH confidence)
- [mobile-dev-inc/Maestro#1703 — Animation flakiness after navigation](https://github.com/mobile-dev-inc/maestro/issues/1703) — Confirmed, closed "not planned" (HIGH confidence)
- [mobile-dev-inc/Maestro#2706 — `--format` flag causes false failures](https://github.com/mobile-dev-inc/maestro/issues/2706) — Confirmed regression in 2.0.x (HIGH confidence)
- [mobile-dev-inc/Maestro#2750 — Headless CI app relaunch failure](https://github.com/mobile-dev-inc/maestro/issues/2750) — Open issue, Android-only in headless mode (HIGH confidence)
- [Maestro CLI Commands and Options](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) — Official format flags documentation (HIGH confidence)
- [Android Emulator Hardware Acceleration](https://developer.android.com/studio/run/emulator-acceleration) — KVM/HAXM requirements, TCG fallback 8-12x slower (HIGH confidence)
- [Run a Headless Android Device on Ubuntu](https://gist.github.com/nhtua/2d294f276dc1e110a7ac14d69c37904f) — `-no-window -gpu swiftshader_indirect` approach (MEDIUM confidence)
- [GitHub Actions: Hardware accelerated Android virtualization](https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/) — Confirmed larger Linux runners support KVM (HIGH confidence)
- [dart-lang/test JSON Reporter Protocol](https://github.com/dart-lang/test/blob/master/pkgs/test/doc/json_reporter.md) — Official event type reference (HIGH confidence)
- [flutter/flutter#138713 — xcrun simctl spawn hang](https://github.com/flutter/flutter/issues/138713) — iOS simulator hang after test runs (MEDIUM confidence)
- [flutter/flutter#168896 — Java/Gradle version mismatch](https://github.com/flutter/flutter/issues/168896) — Confirmed Java home context mismatch in CI (HIGH confidence)
- [CocoaPods specs repository out of date](https://www.kindacode.com/article/flutter-error-cocoapodss-specs-repository-is-too-out-of-date) — CocoaPods cache staleness confirmed (MEDIUM confidence)
- [Bitrise Android Emulator Timeout](https://discuss.bitrise.io/t/android-emulator-timeout-after-5400-seconds/9208) — Real-world 5400s timeout in CI (HIGH confidence)
- [Dart analyze documentation](https://dart.dev/tools/dart-analyze) — Exit code and severity flag behavior (HIGH confidence)

---
*Pitfalls research for: Flutter mobile verification and UAT in Forge v1.1*
*Researched: 2026-03-28*
