# Architecture Research

**Domain:** Flutter mobile verification integration into Forge autonomous pipeline (v1.1)
**Researched:** 2026-03-28
**Confidence:** HIGH (existing source code read directly; Maestro CLI verified via official docs; Flutter CLI behavior confirmed via official Dart/Flutter documentation)

---

## System Overview

The existing Forge pipeline has two verification layers that Flutter support must integrate with:

1. **Programmatic verifiers** (run after every phase, `src/verifiers/`) — deterministic code checks
2. **UAT gate** (run once after spec compliance, `src/uat/`) — end-to-end user workflow tests

Flutter support adds new implementations to both layers without changing their interfaces.

```
┌────────────────────────────────────────────────────────────────────┐
│                    Forge Pipeline FSM                               │
│   wave_1 → human_checkpoint → wave_2 → wave_3 → uat → completed   │
├────────────────────────────────────────────────────────────────────┤
│                    Phase Runner (per phase)                          │
│     context → plan → verify plan → execute → [VERIFY] → gap close  │
├──────────────┬─────────────────────────────────────────────────────┤
│              │              Verifier Registry                        │
│              │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│              │  │  files   │ │  tests   │ │typecheck │ │  lint  │ │
│              │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│              │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│              │  │coverage  │ │  observ  │ │  docker  │ │deploy  │ │
│              │  └──────────┘ └──────────┘ └──────────┘ └────────┘ │
│              │  ┌────────────────┐ ┌─────────────────┐  NEW v1.1  │
│              │  │ mobile-build   │ │ mobile-analyze  │            │
│              │  └────────────────┘ └─────────────────┘            │
├──────────────┴─────────────────────────────────────────────────────┤
│                         UAT Gate                                    │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐  │
│  │  web / api / cli         │    │       flutter UAT            │  │
│  │  (existing)              │    │  emulator.ts + maestro.ts    │  │
│  └──────────────────────────┘    └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Questions Answered

### Q1: New files vs. extending existing verifiers?

**Answer: New files.**

Create `src/verifiers/mobile-build.ts` and `src/verifiers/mobile-analyze.ts`. Do not extend `tests.ts` or `typecheck.ts`.

**Rationale:** Every verifier in the registry implements `(config: VerifierConfig) => Promise<VerifierResult>` with no framework-specific branching. The existing `testsVerifier` handles vitest/jest JSON output; `typecheckVerifier` runs `tsc --noEmit`. Adding Flutter branches to these files would require conditional logic gated on `config.forgeConfig.testing.stack`, making both the existing logic and the new Flutter logic harder to unit test independently.

The skip-if-missing pattern (`skippedResult()` when `pubspec.yaml` is absent) is already established and keeps cross-project behavior clean: a TypeScript project will skip `mobile-build` the same way a Flutter project skips `typecheck`.

**Registration in `src/verifiers/index.ts`:** Add two entries to `verifierRegistry` and two to `configToRegistryMap`. Enable/disable via new boolean toggles (`mobile_build`, `mobile_analyze`) in `VerificationConfigSchema`, defaulting to `false`.

### Q2: AppType — "mobile" generic or "flutter" specific?

**Answer: "flutter" specific.**

Extend `AppType = "web" | "api" | "cli"` to `AppType = "web" | "api" | "cli" | "flutter"`.

**Rationale:** TypeScript's exhaustive union checking turns this into a compile-time enforcement mechanism. Every `switch (appType)` in `runner.ts` and `workflows.ts` will fail to compile without a `case "flutter":` branch, making it impossible to accidentally ship incomplete handling. A generic `"mobile"` type would mask this — you would need to add another discriminant inside the mobile case anyway.

When v1.2 adds React Native support, add `"react-native"` separately. Flutter uses `flutter run` + Maestro; React Native uses Metro + Detox. They share nothing at the tool layer.

**Detection:** In `detectAppType()`, check `config.testing.stack.includes("flutter")` OR check for `pubspec.yaml` in `config.cwd`. The `pubspec.yaml` check is more reliable because `testing.stack` depends on the user setting it correctly.

### Q3: Emulator management — separate module or part of UAT runner?

**Answer: Separate module (`src/uat/emulator.ts`).**

**Rationale:** Emulator lifecycle (start background process, poll for boot completion, stop) is self-contained and time-sensitive. It needs independent unit testing with injected exec functions (mock `adb shell getprop` returning `"1"` after N calls). Embedding this in `runner.ts` would make the runner file harder to read and the emulator logic untestable without the full UAT context.

This mirrors how `src/deployment/health-check.ts` is separated from `src/deployment/deployer.ts` — same pattern, same rationale.

**Key implementation detail:** The emulator must be spawned as a detached background process (not blocking), then a polling loop confirms readiness via `adb shell getprop sys.boot_completed`. The standard reliable signal is `sys.boot_completed` returning `1`. Timeout is configurable (default 180 seconds).

### Q4: Maestro output integration with existing UAT result parsing?

**Answer: Separate module (`src/uat/maestro.ts`) using JUnit XML output.**

Maestro supports `maestro test --format junit --output <path> <flowsDir>`. This is the machine-readable format. The JUnit XML maps directly to `WorkflowResult[]` (the existing type): each `<testcase>` element is one workflow, presence of a `<failure>` child indicates failure, `name` attribute provides the workflow ID.

**Integration point in `runner.ts`:** In the Flutter branch of the workflow loop, instead of iterating through `workflows` and calling `buildUATPrompt` + `runStep` for each, call `runMaestroFlows(flowsDir, outputDir, ctx)` which returns `WorkflowResult[]`. These results are merged into `allResults` exactly as existing `verifyUATResults` results are today. Gap closure operates on the same `WorkflowResult[]` regardless of app type.

**Why not parse Maestro stdout?** Maestro's console output format is not documented as stable and varies with terminal ANSI settings and version updates. The `--format junit` flag produces deterministic, version-stable XML.

### Q5: Config changes needed?

**Testing config additions** (`TestingConfigSchema`):
- `flutter_avd_name: z.string().default("Pixel_7_API_34")` — which AVD to launch
- `flutter_build_flavor: z.string().default("debug")` — build flavor for verifier
- `maestro_flows_dir: z.string().default(".maestro")` — where Maestro flows live

**Verification config additions** (`VerificationConfigSchema`):
- `mobile_build: z.boolean().default(false)` — run `flutter build apk --debug`
- `mobile_analyze: z.boolean().default(false)` — run `flutter analyze`

**TypeScript interface additions** to `ForgeConfig.testing`:
- `flutterAvdName: string`
- `flutterBuildFlavor: string`
- `maestroFlowsDir: string`

**TypeScript interface additions** to `ForgeConfig.verification`:
- `mobileBuild: boolean`
- `mobileAnalyze: boolean`

**configToRegistryMap additions** in `src/verifiers/index.ts`:
- `"mobileBuild" -> "mobile-build"`
- `"mobileAnalyze" -> "mobile-analyze"`

### Q6: Reuse execWithTimeout or different execution pattern?

**Answer: Reuse `execWithTimeout` for all mobile tool invocations. Use `spawn` only for the emulator background process.**

`execWithTimeout` from `src/verifiers/utils.ts` handles timeout, 10MB buffer, NO_COLOR env, and graceful error capture without throwing on non-zero exit codes. All Flutter CLI commands (`flutter build`, `flutter analyze`, `flutter test`, `adb shell getprop`) should use it directly.

**The one exception:** The Android emulator must be spawned as a persistent background process. Use Node.js `spawn` with `detached: true` and `stdio: 'ignore'` in `emulator.ts`. This is the only legitimate use of `spawn` outside the existing SDK query wrapper pattern. After launching the emulator process, `waitForEmulatorReady()` then uses `execWithTimeout("adb shell getprop sys.boot_completed", ...)` in a polling loop.

**Timeout values for Flutter commands:**
- `flutter build apk --debug`: 300,000ms (5 minutes — Gradle builds are slow)
- `flutter analyze`: 60,000ms
- `flutter test --machine`: 120,000ms (same as existing test runner)
- `adb shell getprop`: 5,000ms per poll
- `maestro test`: 300,000ms (depends on number of flows)

---

## Recommended Project Structure

```
src/
├── verifiers/
│   ├── index.ts           # Registry — ADD mobile-build and mobile-analyze
│   ├── types.ts           # VerifierConfig, VerifierResult — UNCHANGED
│   ├── utils.ts           # execWithTimeout() — UNCHANGED, REUSE
│   ├── tests.ts           # Existing — UNCHANGED
│   ├── typecheck.ts       # Existing — UNCHANGED
│   ├── mobile-build.ts    # NEW: flutter build apk --debug, exit code check
│   └── mobile-analyze.ts  # NEW: flutter analyze, issue count parsing
├── uat/
│   ├── types.ts           # ADD "flutter" to AppType union
│   ├── runner.ts          # ADD Flutter branches in detectAppType, startApplication,
│   │                      #   waitForHealth, buildUATPrompt, main workflow loop,
│   │                      #   stopApplication
│   ├── workflows.ts       # Workflow extraction — UNCHANGED
│   ├── emulator.ts        # NEW: startEmulator, waitForEmulatorReady, stopEmulator
│   └── maestro.ts         # NEW: runMaestroFlows, JUnit XML parsing
└── config/
    └── schema.ts          # ADD mobile config fields (6 new fields total)
```

---

## Data Flow

### Flutter Verifier Flow (Phase Runner → Verifiers)

```
Phase Runner calls runVerifiers(config)
    ↓
runVerifiers() reads VerificationConfig toggles
    ↓ (mobileBuild: true AND mobileAnalyze: true)

PARALLEL:
  mobile-build.ts:
    → check pubspec.yaml exists → SKIP if missing
    → execWithTimeout("flutter build apk --debug", cwd, 300_000)
    → exit code 0 → passed: true
    → exit code 1 → extract error lines from stderr → passed: false

  mobile-analyze.ts:
    → check pubspec.yaml exists → SKIP if missing
    → execWithTimeout("flutter analyze --no-fatal-infos", cwd, 60_000)
    → parse stdout for "No issues found" → passed: true
    → parse stdout for "N issues found" → collect issues → passed: false
    ↓
VerificationReport aggregated → gap closure if any failed
```

### Flutter UAT Flow (Pipeline → UAT Gate)

```
Pipeline calls runUAT(uatCtx) where config.testing.stack = "flutter"
    ↓
detectAppType() checks stack string AND pubspec.yaml presence → "flutter"
    ↓
emulator.ts: startEmulator(config.testing.flutterAvdName)
    → spawn("emulator -avd <name> -no-window -no-audio")
    → waitForEmulatorReady(timeoutMs=180_000):
        loop: execWithTimeout("adb shell getprop sys.boot_completed") every 3s
        → returns device serial when "1" returned
    ↓
runStep("flutter-run", prompt including device serial) [agent handles flutter run]
    ↓
maestro.ts: runMaestroFlows(flowsDir, ".forge/maestro/", ctx)
    → execWithTimeout("maestro test --format junit
                       --output .forge/maestro/results.xml .maestro/")
    → readFileSync(".forge/maestro/results.xml")
    → parseJUnitXml() → WorkflowResult[]
    ↓
gap closure loop for failed workflows (same runUATGapClosure — UNCHANGED)
    ↓
emulator.ts: stopEmulator()  ← MUST run in finally block
    → execWithTimeout("adb emu kill")
    ↓
UATResult returned to pipeline controller
```

### Config Extension

```
forge.config.json (snake_case on disk):
{
  "testing": {
    "stack": "flutter",
    "flutter_avd_name": "Pixel_7_API_34",
    "flutter_build_flavor": "debug",
    "maestro_flows_dir": ".maestro"
  },
  "verification": {
    "mobile_build": true,
    "mobile_analyze": true
  }
}

TypeScript (camelCase via serialization layer):
config.testing.flutterAvdName         → "Pixel_7_API_34"
config.testing.flutterBuildFlavor     → "debug"
config.testing.maestroFlowsDir        → ".maestro"
config.verification.mobileBuild       → true
config.verification.mobileAnalyze     → true
```

---

## Architectural Patterns

### Pattern 1: New Verifiers as Separate Files

**What:** `mobile-build.ts` and `mobile-analyze.ts` implement the `Verifier` type (`(config: VerifierConfig) => Promise<VerifierResult>`). They self-skip when `pubspec.yaml` is absent.

**When to use:** Any new programmatic check targeting a specific toolchain.

**Trade-offs:** Two new files. Benefit: independent unit tests, zero coupling to existing verifiers, TypeScript type checking guarantees interface compatibility.

**Example structure:**
```typescript
export const mobileFlutterBuildVerifier: Verifier = async (config) => {
  const pubspecPath = path.resolve(config.cwd, "pubspec.yaml");
  if (!fs.existsSync(pubspecPath)) {
    return skippedResult("mobile-build", "No pubspec.yaml found");
  }
  const flavor = config.forgeConfig.testing.flutterBuildFlavor ?? "debug";
  const result = await execWithTimeout(
    `flutter build apk --${flavor}`,
    config.cwd,
    300_000,
  );
  const passed = result.exitCode === 0;
  return {
    passed,
    verifier: "mobile-build",
    details: [`flutter build apk --${flavor}: exit code ${result.exitCode}`],
    errors: passed ? [] : extractBuildErrors(result.stderr),
  };
};
```

### Pattern 2: "flutter" as Specific AppType

**What:** `AppType = "web" | "api" | "cli" | "flutter"` — TypeScript exhaustive union.

**When to use:** Always when adding a new app paradigm with distinct tooling.

**Trade-offs:** Every switch on `AppType` must add a case. This is the intent — compile-time enforcement that no case is silently missed.

**Detection logic in `detectAppType()`:**
```typescript
export function detectAppType(config: ForgeConfig, cwd: string): AppType {
  const stack = config.testing.stack.toLowerCase();
  if (stack.includes("flutter") || fs.existsSync(path.resolve(cwd, "pubspec.yaml"))) {
    return "flutter";
  }
  // ... existing web/api/cli logic unchanged
}
```

### Pattern 3: Emulator as Lifecycle Module

**What:** `emulator.ts` exports `startEmulator`, `waitForEmulatorReady`, `stopEmulator`. Used only by the Flutter branch of `runner.ts`.

**When to use:** Any time a test infrastructure component has a multi-step lifecycle with async wait-for-ready semantics.

**Implementation approach:**
- `startEmulator`: `spawn("emulator", ["-avd", avdName, "-no-window", "-no-audio"], { detached: true, stdio: "ignore" })`
- `waitForEmulatorReady`: poll `adb shell getprop sys.boot_completed` every 3 seconds; return serial from `adb devices` on success
- `stopEmulator`: `execWithTimeout("adb emu kill", ...)` as primary; `execWithTimeout("adb devices | grep emulator | cut -f1 | xargs kill")` as fallback

**Critical: wrap in try/finally in `runner.ts`** so teardown always runs even if Maestro or gap closure throws.

### Pattern 4: Maestro JUnit XML Parsing

**What:** `maestro.ts` runs `maestro test --format junit --output <path> <flowsDir>` and parses the resulting XML into `WorkflowResult[]`.

**When to use:** Any time Maestro is the test executor.

**JUnit XML structure from Maestro:**
```xml
<testsuite name="Maestro" tests="3" failures="1">
  <testcase name="login-flow" classname="flows/login.yaml" time="4.2"/>
  <testcase name="checkout-flow" classname="flows/checkout.yaml" time="8.1">
    <failure message="Element not found: Add to Cart button"/>
  </testcase>
</testsuite>
```

**Mapping to WorkflowResult:**
- `testcase.name` → `workflowId`
- no `<failure>` child → `passed: true`
- `<failure message="...">` → `passed: false`, `errors: [message]`

**Why JUnit XML, not stdout:** Maestro's console output is not a documented stable format. The `--format junit` flag produces deterministic machine-readable output confirmed in Maestro's official CLI documentation.

---

## Integration Points — Existing Modules to Modify

| Module | Change | Scope |
|--------|--------|-------|
| `src/config/schema.ts` | Add 3 fields to `TestingConfigSchema`, 2 to `VerificationConfigSchema`, update `ForgeConfig` interface | LOW — additive, all with defaults |
| `src/verifiers/index.ts` | Import + register `mobile-build` and `mobile-analyze` in `verifierRegistry` and `configToRegistryMap` | LOW — additive only |
| `src/uat/types.ts` | Add `"flutter"` to `AppType` union | LOW — TS will surface all unhandled cases as compile errors |
| `src/uat/runner.ts` | Add `"flutter"` branches in `detectAppType()`, `startApplication()`, `waitForHealth()`, `buildUATPrompt()`, main workflow loop, `stopApplication()` | MEDIUM — 6 branch sites but each is isolated |
| `src/pipeline/mock-manager.ts` | Add `"firebase"`, `"supabase-realtime"`, `"flutter"` to service keyword detection | LOW — additive |

## Integration Points — New Modules

| Module | Exports | Depends On |
|--------|---------|------------|
| `src/verifiers/mobile-build.ts` | `mobileFlutterBuildVerifier: Verifier` | `execWithTimeout` (utils.ts), `skippedResult` (types.ts) |
| `src/verifiers/mobile-analyze.ts` | `mobileFlutterAnalyzeVerifier: Verifier` | `execWithTimeout` (utils.ts), `skippedResult` (types.ts) |
| `src/uat/emulator.ts` | `startEmulator()`, `waitForEmulatorReady()`, `stopEmulator()`, `EmulatorContext` interface | `execWithTimeout` (verifiers/utils.ts), `node:child_process` spawn |
| `src/uat/maestro.ts` | `runMaestroFlows()` returning `WorkflowResult[]` | `execWithTimeout` (verifiers/utils.ts), XML parsing (inline or `fast-xml-parser`) |

---

## Anti-Patterns

### Anti-Pattern 1: Extending Existing Verifiers for Flutter

**What people do:** Add a Flutter branch inside `testsVerifier` (e.g., `if (isFlutterProject) { run flutter test }`).

**Why it's wrong:** `testsVerifier` already has complex JSON output parsing for vitest/jest via a temp file. Adding a Flutter branch means it now owns two distinct execution paths with different output parsers. The `skippedResult` logic for "no test script" conflicts with "no pubspec.yaml." Unit tests must cover both paths with different mocked inputs.

**Do this instead:** Create `mobile-build.ts` and `mobile-analyze.ts`. Existing verifiers skip on non-matching projects via their own presence checks; mobile verifiers skip on missing `pubspec.yaml`. Zero cross-contamination.

### Anti-Pattern 2: Generic "mobile" AppType

**What people do:** Add `"mobile"` and handle both Flutter and React Native in one case.

**Why it's wrong:** Flutter uses `flutter run` (Dart VM) + Maestro YAML flows. React Native uses Metro bundler + Detox (JavaScript-based). The emulator commands, app start detection, and test frameworks are completely different. A generic `"mobile"` type requires internal discriminants that defeat the purpose of the union type.

**Do this instead:** Add `"flutter"` now. Add `"react-native"` in v1.2. Each gets explicit `case` branches. TypeScript catches missing cases at compile time.

### Anti-Pattern 3: Blocking on Emulator Start

**What people do:** Call `flutter emulators --launch <name>` synchronously and immediately run Maestro.

**Why it's wrong:** The emulator process takes 60-120 seconds to boot. Maestro will fail with `device not found` errors. `flutter emulators --launch` returns immediately — it does not wait for the emulator to be ready.

**Do this instead:** Spawn the emulator as a detached background process. Poll `adb shell getprop sys.boot_completed` every 3 seconds in `waitForEmulatorReady()` with a configurable timeout (default 180 seconds). Only proceed when `sys.boot_completed` returns `1`.

### Anti-Pattern 4: Parsing Maestro stdout for Pass/Fail

**What people do:** Grep `maestro test` stdout for "PASSED" / "FAILED" strings.

**Why it's wrong:** Maestro's console output format varies with ANSI settings, verbose flags, and version updates. It is not a documented stable interface. Upstream version bumps will silently break the parser.

**Do this instead:** Always use `maestro test --format junit --output <path>`. Parse the JUnit XML file. This is Maestro's documented machine-readable output format and is stable across versions.

### Anti-Pattern 5: Skipping Emulator Teardown on Test Failure

**What people do:** If Maestro fails or gap closure throws, let the emulator keep running.

**Why it's wrong:** Running Android emulators consume 1-4GB RAM. Repeated Forge runs on the same machine exhaust memory within 2-3 runs.

**Do this instead:**
```typescript
// In the Flutter branch of runner.ts:
const emulatorSerial = await startEmulator(config.testing.flutterAvdName, ctx);
try {
  // ... flutter run, maestro flows, gap closure
} finally {
  await stopEmulator(emulatorSerial, ctx); // ALWAYS runs
}
```

---

## Build Order

Build order respects inward dependencies (modules used by others built first):

1. **`src/config/schema.ts` extension** — Everything downstream reads `ForgeConfig`. Correct TypeScript types across the codebase from the start. Add all 5 new fields with defaults. This causes no test failures — all new fields have defaults.

2. **`src/verifiers/mobile-build.ts`** — Simple verifier: check `pubspec.yaml`, run `flutter build apk --debug`, parse exit code. Write unit tests with mocked exec (mock `execWithTimeout` to return exit 0 or exit 1). No other dependencies.

3. **`src/verifiers/mobile-analyze.ts`** — Same pattern. Run `flutter analyze --no-fatal-infos`, parse `No issues found` / `N issues found` from stdout. Write unit tests with mocked exec.

4. **`src/verifiers/index.ts` update** — Register both new verifiers. Add to `verifierRegistry` and `configToRegistryMap`. Add to `configToRegistryMap`. Existing tests continue to pass because new verifiers are disabled by default (`mobileBuild: false`, `mobileAnalyze: false`).

5. **`src/uat/types.ts` update** — Add `"flutter"` to `AppType`. TypeScript immediately surfaces all unhandled switch cases in `runner.ts` as compile errors. Use these as a checklist for step 7.

6. **`src/uat/emulator.ts`** — Implement `startEmulator`, `waitForEmulatorReady`, `stopEmulator`. Write unit tests using injected `execFn` mock (simulate `adb shell getprop` returning `""` then `""` then `"1"` to test the polling loop). Verify timeout behavior. Verify stop runs on exception via try/finally.

7. **`src/uat/maestro.ts`** — Implement `runMaestroFlows`. Write a JUnit XML parser. Write unit tests using fixture XML files (one passing, one with a failure element). Verify the `WorkflowResult[]` shape. Test the `execWithTimeout` invocation with the correct flags.

8. **`src/uat/runner.ts` update** — Add `"flutter"` branches guided by the TypeScript compile errors from step 5:
   - `detectAppType()`: check `pubspec.yaml` in addition to stack string
   - `startApplication()`: skip Docker, delegate to `emulator.ts`
   - `waitForHealth()`: skip HTTP poll for Flutter — readiness already confirmed by emulator boot in `startApplication()`
   - `buildUATPrompt()`: add `"flutter"` case with Maestro-specific instructions
   - Main workflow loop: call `maestro.ts` instead of per-workflow `buildUATPrompt` + `runStep`
   - `stopApplication()`: call `stopEmulator()` (in finally block)

9. **Integration tests** — Test the full Flutter UAT path with mocked exec and mocked `runStepFn`. No real AVD required. Verify `WorkflowResult[]` shape from Maestro parser reaches `allResults`. Verify emulator teardown runs when Maestro throws.

---

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single developer (local) | Current design — one AVD, sequential Maestro flows |
| CI/CD (cloud) | Replace local AVD with cloud Android emulators (Firebase Test Lab, Bitrise); skip `emulator.ts` entirely when `ANDROID_EMULATOR_SERIAL` env var is set |
| Multiple device configs | Add `flutterDevices: string[]` to config; run Maestro with `--shards N` across multiple connected emulators |

---

## Sources

- Maestro CLI commands and output format: [Maestro CLI Commands and Options](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) — HIGH confidence
- Maestro JUnit report format: confirmed via web search — `maestro test --format junit --output results.xml .maestro/` is documented stable interface — HIGH confidence
- Flutter test `--machine` flag for JSON output: [Flutter CLI parsable output issue #50449](https://github.com/flutter/flutter/issues/50449) — MEDIUM confidence (GitHub issue, not official docs)
- Flutter project detection via `pubspec.yaml`: [Flutter pubspec options](https://docs.flutter.dev/tools/pubspec) — HIGH confidence (official)
- Android emulator readiness via `adb shell getprop sys.boot_completed`: [Android Debug Bridge](https://developer.android.com/tools/adb) — HIGH confidence (official)
- Emulator headless CI flags (`-no-window -no-audio`): confirmed via web search, available since emulator v28.0.25 — MEDIUM confidence
- Existing Forge source (read directly): `src/verifiers/`, `src/uat/`, `src/config/schema.ts`, `src/pipeline/pipeline-controller.ts`, `src/deployment/` — HIGH confidence

---
*Architecture research for: Forge v1.1 Flutter mobile verification integration*
*Researched: 2026-03-28*
