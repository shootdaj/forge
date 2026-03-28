# Phase 12: iOS Simulator Support - Context

**Gathered:** 2026-03-28 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers **iOS Simulator support** as an alternative to the Android emulator for Flutter mobile app UAT. It adds:
1. iOS Simulator lifecycle management — boot via `xcrun simctl`, readiness detection, guaranteed shutdown
2. Flutter iOS build with `--no-codesign` — no Apple Developer account or provisioning profile required
3. Maestro flows running against the iOS Simulator — same flow YAML files used for Android
4. UAT runner platform routing — config-driven choice between Android emulator and iOS Simulator

**Not in scope:** Android emulator changes (Phase 10 — done), Maestro flow generation changes (Phase 11 — done), Flutter verifiers (Phase 9 — done).

</domain>

<decisions>
## Implementation Decisions

[auto] Selected all gray areas and auto-resolved with recommended defaults.

### 1. iOS Simulator Module Structure (IOS-01)
**Decision:** Create `src/uat/ios-simulator.ts` and `src/uat/ios-simulator-types.ts` mirroring the emulator.ts pattern from Phase 10. Export these functions:
- `listAvailableSimulators(execFn?): SimulatorDevice[]` — parse `xcrun simctl list devices available -j` JSON output
- `findBestSimulator(devices: SimulatorDevice[], preferred?: string): SimulatorDevice` — pick simulator: prefer user-specified device name, fall back to newest available iPhone
- `bootSimulator(options: SimulatorBootOptions): SimulatorHandle` — run `xcrun simctl boot <udid>`, return handle
- `waitForSimulatorReady(handle: SimulatorHandle, options?: SimulatorWaitOptions): Promise<void>` — poll `xcrun simctl list devices` until device state is "Booted"
- `shutdownSimulator(handle: SimulatorHandle, execFn?): Promise<void>` — run `xcrun simctl shutdown <udid>`, never throws
- `withSimulator(options, callback): Promise<T>` — high-level wrapper with try/finally (same pattern as `withEmulator`)
- `registerSimulatorCleanup(handle: SimulatorHandle): () => void` — process exit handler

All functions accept injectable `execFn` for unit testing without real `xcrun` binary.

**Rationale:** Follows the exact same architecture as `emulator.ts` from Phase 10. The `withSimulator` wrapper provides the same guarantee pattern (boot -> ready -> callback -> shutdown in finally).

### 2. Simulator Types and Error Classes (IOS-01)
**Decision:** Create `src/uat/ios-simulator-types.ts` with:
```typescript
interface SimulatorDevice {
  udid: string;
  name: string;        // e.g., "iPhone 15 Pro"
  state: string;       // "Shutdown" | "Booted"
  runtime: string;     // e.g., "com.apple.CoreSimulator.SimRuntime.iOS-17-5"
  isAvailable: boolean;
}

interface SimulatorHandle {
  udid: string;
  name: string;
  runtime: string;
  startedAt: string;
}

interface SimulatorBootOptions {
  deviceName?: string;    // Preferred device name (e.g., "iPhone 15 Pro")
  timeoutMs?: number;     // Boot readiness timeout (default: 120000)
  pollIntervalMs?: number; // Polling interval (default: 2000)
  execFn?: (cmd: string) => string;
}

interface SimulatorWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  execFn?: (cmd: string) => string;
}
```

Error classes:
- `SimulatorError` — base class
- `SimulatorBootTimeoutError` — boot polling exceeded timeout
- `SimulatorNotFoundError` — no matching simulator device available
- `XcodeNotAvailableError` — `xcrun simctl` not found (Xcode not installed)

**Rationale:** Same error hierarchy pattern as `emulator-types.ts`. The `SimulatorDevice` interface maps directly to `xcrun simctl list devices -j` JSON output.

### 3. Boot Detection Strategy (IOS-01)
**Decision:** After running `xcrun simctl boot <udid>`:
1. Poll `xcrun simctl list devices -j` every 2 seconds
2. Parse JSON output, find the device by UDID
3. Boot is complete when `state` changes from `"Shutdown"` to `"Booted"`
4. Timeout: 120 seconds (iOS Simulator boots faster than Android emulator)
5. On timeout, shut down the simulator and throw `SimulatorBootTimeoutError`

Use the `-j` (JSON) flag for reliable parsing — never parse human-readable text output from simctl.

**Rationale:** Unlike Android (`sys.boot_completed` via `adb shell getprop`), iOS Simulator readiness is determined by the simctl device state. JSON output is deterministic and parseable, unlike the human-readable format which varies across Xcode versions.

### 4. Simulator Device Selection (IOS-01)
**Decision:** `findBestSimulator()` logic:
1. If `config.testing.iosSimulatorDevice` is set (non-empty string), find exact match by name
2. If no config or no match, filter to iPhone devices only (exclude iPad, Apple Watch, Apple TV)
3. Sort by runtime version descending (newest iOS first)
4. Pick the first one (newest iPhone with newest iOS)
5. If no simulators available at all, throw `SimulatorNotFoundError`

Pre-flight check: before attempting boot, verify `xcrun simctl list` succeeds. If it fails (Xcode not installed), throw `XcodeNotAvailableError` with actionable message.

**Rationale:** Auto-detection makes the zero-config experience work. Users who need a specific device can set `ios_simulator_device` in config. iPhone-first filtering avoids accidentally booting an Apple Watch simulator.

### 5. Flutter iOS Build with --no-codesign (IOS-02)
**Decision:** Create `src/verifiers/flutter-build-ios.ts` as a new verifier:
- Command: `flutter build ios --debug --no-codesign --simulator`
- The `--simulator` flag is required to build for the iOS Simulator (not a physical device)
- The `--no-codesign` flag skips code signing — no Apple Developer account needed
- After successful build, verify the `.app` bundle exists at `build/ios/iphonesimulator/Runner.app` (or flavor variant)
- Self-skip via `skippedResult()` when `pubspec.yaml` is absent
- Self-skip on non-macOS platforms (iOS builds only work on macOS)
- Acquires Flutter startup lock before running (same as Android build verifier)
- Timeout: 600 seconds (iOS builds are slower than Android APK builds due to CocoaPods + Xcode compilation)

Register in verifier index as `"flutter-build-ios"`, gated by `mobile_build` config toggle (same as Android build).

**Rationale:** The `--no-codesign` flag is the key enabler — it allows Simulator builds without any Apple Developer Program membership. The `--simulator` flag tells Flutter to build for x86_64/arm64 Simulator architecture, not arm64 device architecture.

### 6. UAT Runner Platform Routing (IOS-03)
**Decision:** Modify `runFlutterUAT()` in `src/uat/runner.ts` to support both platforms:
1. Read `config.testing.mobilePlatform` — `"android"` (default) or `"ios"`
2. For `"android"`: existing path — `withEmulator()` + `withFlutterRun({serial: emulatorHandle.serial})`
3. For `"ios"`: new path — `withSimulator()` + `withFlutterRun({serial: simulatorHandle.udid})`
4. Maestro test execution is identical for both — same `executeMaestroUAT()` call, same flow YAML files
5. The `serial` parameter in `FlutterRunOptions` and `MaestroTestOptions` accepts both an Android serial (e.g., "emulator-5554") and an iOS Simulator UDID

**Key insight:** Maestro natively supports iOS Simulator — same flow YAML files work on both platforms without modification. The `maestro test --device <udid>` flag accepts iOS Simulator UDIDs.

**Rationale:** The platform routing is config-driven so CI pipelines can run UAT on both platforms by changing one config field. The rest of the pipeline (flow generation, test execution, gap closure) is platform-agnostic.

### 7. Config Extension
**Decision:** Add to `TestingConfigSchema`:
- `mobile_platform: z.enum(["android", "ios"]).default("android")` — which platform to use for Flutter UAT
- `ios_simulator_device: z.string().default("")` — preferred iOS Simulator device name (empty = auto-detect)

Add corresponding fields to `ForgeConfig.testing` TypeScript interface:
- `mobilePlatform: "android" | "ios"`
- `iosSimulatorDevice: string`

**Rationale:** Minimal config surface. The platform choice defaults to Android (backward compatible). The simulator device name defaults to auto-detect.

### 8. State Schema Extension
**Decision:** Add `simulator` field to `ForgeStateSchema` alongside existing `emulator` field:
```typescript
const SimulatorStateSchema = z.object({
  udid: z.string().default(""),
  name: z.string().default(""),
  started_at: z.string().optional(),
});
```
Add to root schema: `simulator: z.any().default({}).pipe(SimulatorStateSchema)`

Add corresponding fields to `ForgeState` TypeScript interface.

This enables crash recovery for iOS Simulator (same pattern as emulator PID tracking).

**Rationale:** Follows existing `emulator` state pattern. UDID is the unique identifier for iOS Simulators (equivalent to PID+serial for Android emulators). No PID tracking needed since `xcrun simctl shutdown` works by UDID without needing a process reference.

### 9. Guaranteed Teardown (IOS-01)
**Decision:** Two-layer teardown (simpler than Android's three layers because `xcrun simctl shutdown` works by UDID, not PID):

**Layer 1 — try/finally:** `withSimulator()` wrapper uses try/finally to ensure `shutdownSimulator()` runs.

**Layer 2 — process.on('exit'):** `registerSimulatorCleanup()` attaches a synchronous handler that runs `xcrun simctl shutdown <udid>` synchronously via `execSync`.

No orphan detection layer needed: unlike Android emulators (which are independent processes that persist after parent exits), iOS Simulators persist in a "Booted" state but don't consume significant resources. However, for cleanliness, `shutdownSimulator()` will be called at startup if the state file shows a previously-booted simulator UDID.

**Rationale:** The `xcrun simctl shutdown` command is idempotent (shutting down an already-shutdown simulator is a no-op). This simplifies the teardown compared to Android's three-layer approach.

### 10. Xcode Pre-flight Check
**Decision:** Before any iOS Simulator operation, verify Xcode is available:
1. Run `xcrun simctl list devices -j`
2. If command fails (exit code != 0), throw `XcodeNotAvailableError` with message: "Xcode command-line tools not found. Install Xcode from the App Store and run: sudo xcode-select --install"
3. This check gates all iOS Simulator operations, similar to the KVM check for Android

**Rationale:** Matches the KVM pre-flight pattern from Phase 10. Provides actionable error when Xcode isn't installed rather than cryptic `xcrun` errors.

### Claude's Discretion
- Whether to open Simulator.app GUI (headless by default via `xcrun simctl boot` without opening the app)
- Exact timing for polling interval during boot readiness check (2s recommended)
- Whether to add CocoaPods cache warming (`cd ios && pod install --repo-update`) before iOS builds
- Internal logging verbosity during simulator boot polling

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Forge Architecture
- `SPEC.md` — Overall Forge architecture and behavior spec
- `.planning/REQUIREMENTS.md` — Phase 12 requirements (IOS-01, IOS-02, IOS-03)
- `.planning/phases/10-android-emulator-lifecycle/10-CONTEXT.md` — Phase 10 decisions (emulator lifecycle pattern to mirror)
- `.planning/phases/11-maestro-uat-integration/11-CONTEXT.md` — Phase 11 decisions (Maestro integration, flutter run)

### Existing Code (integration points)
- `src/uat/emulator.ts` — Android emulator lifecycle (pattern to mirror for iOS)
- `src/uat/emulator-types.ts` — Emulator types (pattern to mirror)
- `src/uat/flutter-run.ts` — Flutter run daemon (accepts serial parameter — works with both platforms)
- `src/uat/flutter-run-types.ts` — FlutterRunOptions (serial field)
- `src/uat/maestro.ts` — Maestro test execution (platform-agnostic)
- `src/uat/maestro-types.ts` — MaestroTestOptions (serial/device field)
- `src/uat/runner.ts` — `runFlutterUAT()` (main integration target for platform routing)
- `src/uat/index.ts` — UAT module public API (add new exports)
- `src/verifiers/flutter-build.ts` — Android APK build verifier (pattern to mirror for iOS)
- `src/config/schema.ts` — Config schema (add mobile_platform, ios_simulator_device)
- `src/state/schema.ts` — State schema (add simulator state)
- `src/uat/kvm-check.ts` — KVM pre-flight check (pattern to mirror for Xcode check)

### External References
- [xcrun simctl reference](https://developer.apple.com/documentation/xcode/simctl) — boot, shutdown, list devices
- [Flutter iOS build](https://docs.flutter.dev/deployment/ios) — `--no-codesign`, `--simulator` flags
- [Maestro iOS support](https://docs.maestro.dev/get-started/supported-platform/ios) — Maestro natively supports iOS Simulator

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withEmulator()` in `src/uat/emulator.ts` — Pattern to mirror: try/finally lifecycle wrapper
- `registerCleanupHandler()` in `src/uat/emulator.ts` — Pattern to mirror: process.on('exit') cleanup
- `flutterBuildVerifier` in `src/verifiers/flutter-build.ts` — Pattern to mirror for iOS build verifier
- `withFlutterLock()` in `src/verifiers/flutter-lock.ts` — Reuse for iOS build (serializes Flutter CLI)
- `skippedResult()` in `src/verifiers/types.ts` — Reuse for self-skip on non-macOS platforms
- `execWithTimeout()` in `src/verifiers/utils.ts` — Reuse for xcrun commands
- `assertKvmAvailable()` in `src/uat/kvm-check.ts` — Pattern to mirror for Xcode check

### Established Patterns
- Injectable dependencies for all I/O operations (execFn, spawnFn, fs)
- Co-located unit tests (`.test.ts` next to source files)
- `try/finally` for resource cleanup
- State updates via `stateManager.update()` — camelCase in TS, snake_case on disk
- Error classes extending base Error with descriptive names
- Config uses `z.any().default({}).pipe()` pattern for nested defaults
- Verifiers self-skip via `skippedResult()` when preconditions not met

### Integration Points
- `src/uat/runner.ts` — `runFlutterUAT()` needs platform routing (Android vs iOS)
- `src/uat/index.ts` — Export new iOS simulator modules
- `src/config/schema.ts` — Add `mobile_platform` and `ios_simulator_device` fields
- `src/state/schema.ts` — Add `simulator` state field
- `src/verifiers/flutter-build-ios.ts` — New iOS build verifier

</code_context>

<specifics>
## Specific Ideas

- `xcrun simctl list devices available -j` returns JSON with `{ "devices": { "<runtime>": [{ "udid": "...", "name": "iPhone 15 Pro", "state": "Shutdown" }] } }`
- `xcrun simctl boot <udid>` starts the simulator — does NOT open Simulator.app GUI
- `xcrun simctl shutdown <udid>` is idempotent — safe to call on already-shutdown device
- `flutter build ios --debug --no-codesign --simulator` produces `build/ios/iphonesimulator/Runner.app`
- `flutter run -d <udid>` targets an iOS Simulator by UDID (same pattern as Android serial)
- `maestro test --device <udid>` targets an iOS Simulator (same flag as Android)
- iOS Simulator boots faster than Android emulator (~10-30s vs ~60-90s) — use 120s timeout
- No KVM check needed for iOS — Simulator runs on Apple's built-in Hypervisor Framework
- The pre-flight check is for Xcode availability (command-line tools), not KVM
- CocoaPods cache can become stale — consider `pod install --repo-update` on first build failure as retry

</specifics>

<deferred>
## Deferred Ideas

- Physical iOS device testing (requires code signing, Apple Developer account) — v2+
- Parallel Android + iOS testing (run UAT on both platforms simultaneously) — v2+
- iOS-specific visual regression testing — v2+
- TestFlight deployment integration — v2+

None beyond deferred — discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps via injectable execFn)
- **Integration tests** for iOS simulator state persistence, device selection, build verifier with state manager
- **Scenario tests** for full iOS simulator lifecycle: boot -> ready -> callback -> shutdown -> state cleanup; and for Flutter iOS UAT: simulator + flutter run + maestro test

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 12-ios-simulator-support*
*Context gathered: 2026-03-28*
