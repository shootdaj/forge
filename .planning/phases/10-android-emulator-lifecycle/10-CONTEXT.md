# Phase 10 Context: Android Emulator Lifecycle

**Created:** 2026-03-28 (auto mode)
**Phase Goal:** Forge can reliably start an Android emulator, wait for full boot readiness, and guarantee teardown on any exit path

<domain>
## Phase Boundary

This phase delivers the **Android emulator lifecycle manager** — a self-contained module that handles:
1. Starting a headless Android emulator with CI-friendly flags
2. Polling for boot readiness via `sys.boot_completed`
3. Guaranteed teardown on success, failure, or crash (try/finally + process handlers)
4. Orphan emulator detection and cleanup on startup
5. PID and serial persistence in forge-state.json for crash recovery
6. KVM pre-flight check with actionable error on Linux

**Not in scope:** Maestro UAT (Phase 11), `flutter run` daemon (Phase 11), iOS Simulator (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### 1. Module Location and API Shape
**Decision:** Create `src/uat/emulator.ts` as a self-contained emulator lifecycle module. Export these functions:
- `checkKvmAvailability(platform?: string): KvmCheckResult` — KVM pre-flight check (EMU-06)
- `killOrphanEmulators(execFn?): Promise<string[]>` — detect and kill stale emulators (EMU-04)
- `startEmulator(options: EmulatorStartOptions): Promise<EmulatorHandle>` — spawn emulator process (EMU-01)
- `waitForBoot(handle: EmulatorHandle, options?: BootWaitOptions): Promise<void>` — poll for boot readiness (EMU-02)
- `stopEmulator(handle: EmulatorHandle, execFn?): Promise<void>` — graceful teardown (EMU-03)
- `withEmulator(options, callback): Promise<T>` — high-level wrapper with try/finally (EMU-03)
- `registerCleanupHandler(handle: EmulatorHandle): void` — process.on('exit') handler (EMU-03)

All functions accept injectable `execFn` for unit testing without real adb/emulator binaries.

**Rationale:** Follows research SUMMARY.md architecture recommendation. Lives alongside UAT runner since emulator is only used during UAT.

### 2. Emulator Start Flags
**Decision:** Start emulator with these flags (locked):
```
emulator -avd <avd_name> -no-audio -no-window -gpu swiftshader_indirect -no-boot-anim -no-snapshot-save
```
- `-no-audio -no-window`: headless CI
- `-gpu swiftshader_indirect`: keeps accessibility framework functional for Maestro (not `-gpu off`)
- `-no-boot-anim`: faster boot
- `-no-snapshot-save`: clean state each run

Use `spawn()` with `detached: true` and `stdio: 'pipe'` — NOT `exec` or `execWithTimeout`. The emulator is a long-running daemon process.

**Rationale:** Per research, `-gpu swiftshader_indirect` is required for Maestro to access the accessibility tree. `spawn()` is required because the emulator never exits on its own.

### 3. Boot Readiness Polling
**Decision:** After spawning the emulator:
1. Wait for serial to appear in `adb devices` output (device showing as "device" not "offline")
2. Poll `adb -s <serial> shell getprop sys.boot_completed` every 3 seconds
3. Boot is ready when the property returns `"1"` (trimmed)
4. Timeout: 180 seconds (configurable via `BootWaitOptions.timeoutMs`)
5. On timeout, kill the emulator and throw `EmulatorBootTimeoutError`

Do NOT use `adb wait-for-device` — it fires during early boot before the system is fully ready.

**Rationale:** Per research, `sys.boot_completed` is the only reliable boot indicator. 180s accounts for cold boot on CI machines without KVM acceleration.

### 4. Serial Discovery
**Decision:** After spawning the emulator, discover its serial via `adb devices`. The emulator serial follows the pattern `emulator-<port>` where port is typically 5554, 5556, etc. Parse `adb devices` output, find the new serial that appeared after spawn, and associate it with the handle.

If multiple emulators are running, disambiguate by comparing the device list before and after spawn.

### 5. Guaranteed Teardown
**Decision:** Three-layer teardown guarantee:

**Layer 1 — try/finally:** The `withEmulator()` wrapper uses try/finally to ensure `stopEmulator()` runs regardless of callback success/failure.

**Layer 2 — process.on('exit'):** `registerCleanupHandler()` attaches a synchronous handler to `process.on('exit')` and `process.on('SIGINT')` that calls `process.kill(handle.pid)`. This catches process crashes that bypass try/finally.

**Layer 3 — orphan cleanup on startup:** `killOrphanEmulators()` runs at the start of every emulator operation. It reads forge-state.json for the last known PID/serial, checks if that process is still running, and kills it if so.

`stopEmulator()` implementation: first try `adb -s <serial> emu kill` (graceful), wait 5 seconds, then `process.kill(pid, 'SIGKILL')` if still alive.

**Rationale:** The three-layer approach covers: normal exit (Layer 1), crash/SIGINT (Layer 2), and previous crash leaving orphans (Layer 3). Research confirms emulator leak exhausts RAM after 3-4 runs.

### 6. Orphan Detection on Startup (EMU-04)
**Decision:** `killOrphanEmulators()` implementation:
1. Read `emulator.pid` and `emulator.serial` from forge-state.json
2. Run `adb devices` to get currently running emulators
3. If any emulator matches the stored serial, kill it via `adb -s <serial> emu kill`
4. If stored PID is still alive (checked via `process.kill(pid, 0)`), send SIGKILL
5. Clear the emulator state from forge-state.json after cleanup
6. Also kill any emulator processes found via `adb devices` that are not tracked in state (belt-and-suspenders)

**Rationale:** Cross-referencing state file with `adb devices` catches both tracked orphans (from previous Forge runs) and untracked ones.

### 7. State Schema Extension (EMU-05)
**Decision:** Add `emulator` field to `ForgeStateSchema`:
```typescript
const EmulatorStateSchema = z.object({
  pid: z.number().int().default(0),
  serial: z.string().default(""),
  avd_name: z.string().default(""),
  started_at: z.string().optional(),
});
```
Add to root schema: `emulator: z.any().default({}).pipe(EmulatorStateSchema)`

Add corresponding fields to the `ForgeState` TypeScript interface.

**Rationale:** Follows existing pattern (same as `deployment` state). PID + serial enables crash recovery. Using `z.any().default({}).pipe()` pattern from MEMORY.md.

### 8. KVM Pre-flight Check (EMU-06)
**Decision:** `checkKvmAvailability()` checks platform and KVM status:
- **macOS (darwin):** Always available — Apple Hypervisor Framework (HVF) is built-in. Return `{ available: true }`.
- **Linux:** Check if `/dev/kvm` exists AND is readable. If not:
  - Return `{ available: false, message: "KVM not available. Install kvm and add user to kvm group: sudo apt install qemu-kvm && sudo usermod -aG kvm $USER" }`
- **Windows:** Return `{ available: false, message: "Windows is not supported for Android emulator operations. Use WSL2 with KVM." }`

This check runs BEFORE any emulator operation. If KVM is unavailable on Linux, throw `KvmUnavailableError` with the actionable message.

**Rationale:** Per research, KVM is always available on macOS (HVF). On Linux, `/dev/kvm` is the standard check. Actionable error messages help CI setup.

### 9. Error Types
**Decision:** Create dedicated error classes:
- `EmulatorBootTimeoutError` — boot polling exceeded 180s
- `KvmUnavailableError` — KVM not available (Linux only)
- `EmulatorStartError` — emulator process exited unexpectedly during startup
- `OrphanCleanupError` — non-fatal, logged as warning

All extend a base `EmulatorError` class.

### 10. Injectable Dependencies for Testing
**Decision:** All functions accept an optional `execFn` parameter (`(cmd: string) => string` or `(cmd: string) => Promise<string>`) for unit testing. The emulator spawn uses an injectable `spawnFn` for testing the process management without real processes.

Default implementations use `execSync` and `spawn` from `node:child_process`.

**Rationale:** Matches the existing pattern in `src/uat/runner.ts` (UATContext.execFn). Enables comprehensive unit testing without real Android SDK.

### Claude's Discretion
- Internal logging verbosity during boot polling (info vs debug level)
- Exact timing for grace period between `adb emu kill` and SIGKILL (5s recommended)
- Whether to also check `pm path android` as secondary boot indicator (optional)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Forge Architecture
- `SPEC.md` -- Overall Forge architecture and behavior spec
- `.planning/research/SUMMARY.md` -- v1.1 research findings, emulator lifecycle patterns, pitfalls
- `.planning/REQUIREMENTS.md` -- Phase 10 requirements (EMU-01 through EMU-06)
- `.planning/phases/09-flutter-verifier-infrastructure/09-CONTEXT.md` -- Prior phase decisions

### Existing Code (integration points)
- `src/state/schema.ts` -- ForgeStateSchema, Zod patterns, `z.any().default({}).pipe()` pattern
- `src/state/state-manager.ts` -- StateManager for reading/writing emulator PID/serial
- `src/uat/types.ts` -- AppType union, UATContext with injectable execFn
- `src/uat/runner.ts` -- detectAppType(), existing UAT flow
- `src/verifiers/utils.ts` -- execWithTimeout() utility for adb commands
- `src/config/schema.ts` -- ForgeConfigSchema, `flutter_avd_name` field

### External References
- [Android emulator CLI](https://developer.android.com/studio/run/emulator-commandline) -- `-no-window`, `-no-audio`, `-gpu` flags
- [ADB reference](https://developer.android.com/tools/adb) -- `sys.boot_completed`, `adb emu kill`, `adb devices`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `execWithTimeout()` in `src/verifiers/utils.ts` -- Use for `adb` commands (NOT for emulator spawn)
- `StateManager` in `src/state/state-manager.ts` -- Use for persisting emulator PID/serial
- `UATContext.execFn` pattern in `src/uat/types.ts` -- Follow this injectable exec pattern
- `z.any().default({}).pipe()` pattern in `src/config/schema.ts` -- Use for nested EmulatorStateSchema

### Established Patterns
- State schema uses snake_case on disk, camelCase in TypeScript (case-transform layer)
- Verifier/UAT modules accept injectable dependencies for unit testing
- Error classes extend base Error with descriptive names
- Tests co-located as `.test.ts` next to source files for unit tests; `test/integration/` and `test/scenarios/` for higher tiers

### Integration Points
- `src/state/schema.ts` -- Add EmulatorStateSchema, extend ForgeStateSchema and ForgeState interface
- `src/uat/` directory -- New `emulator.ts` module lives here
- Pipeline will call emulator lifecycle during UAT phase (Phase 11 wires this in)

</code_context>

<specifics>
## Specific Ideas

- Use `spawn()` with `detached: true` for the emulator process -- it's a long-lived daemon
- The `withEmulator()` high-level API should be the primary interface for Phase 11 integration
- Store `child.pid` immediately after spawn, before waiting for boot -- enables cleanup even if boot fails
- Log each poll attempt during boot wait so operators can see progress
- The AVD name comes from `config.testing.flutterAvdName` (already in schema from Phase 9)
- On CI, emulator cold boot typically takes 60-90 seconds; 180s timeout gives generous margin

</specifics>

<deferred>
## Deferred Ideas

- iOS Simulator lifecycle via `xcrun simctl` -- Phase 12
- Emulator snapshot management for faster boot -- v2+
- GPU acceleration detection and optimization -- v2+
- Multiple concurrent emulator support -- v2+

None -- discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps via injectable execFn/spawnFn)
- **Integration tests** for emulator state persistence, orphan detection flow, KVM check with state manager
- **Scenario tests** for full emulator lifecycle: start -> boot wait -> callback -> teardown -> state cleanup

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 10-android-emulator-lifecycle*
*Context gathered: 2026-03-28*
