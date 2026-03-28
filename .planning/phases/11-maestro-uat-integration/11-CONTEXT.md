# Phase 11: Maestro UAT Integration - Context

**Gathered:** 2026-03-28 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the **Maestro UAT integration** — the final piece that makes Flutter mobile apps fully testable end-to-end by Forge. It adds:
1. `flutter run` daemon management — spawn, stdout-based ready signal detection, PID-based teardown in finally block
2. Maestro flow generation — agent generates `.maestro/` YAML flows from requirements with semantic identifiers
3. Maestro test execution — runs `maestro test --format junit`, parses JUnit XML via `junit2json`
4. Defense-in-depth result parsing — checks BOTH exit code AND JUnit XML content (known Maestro regression)
5. Gap closure integration — Maestro UAT failures trigger existing `runUATGapClosure` loop
6. Semantic identifier guidance in UAT prompts — ensures agent generates Maestro-friendly widgets

**Not in scope:** Emulator lifecycle (Phase 10 — done), Flutter verifiers (Phase 9 — done), iOS Simulator (Phase 12).

</domain>

<decisions>
## Implementation Decisions

[auto] Selected all gray areas and auto-resolved with recommended defaults.

### 1. Flutter Run Daemon Management (MAE-03, MAE-04)
**Decision:** Create `src/uat/flutter-run.ts` as a self-contained module for managing the `flutter run` daemon. Export these functions:
- `startFlutterRun(options: FlutterRunOptions): FlutterRunHandle` — spawn `flutter run` with `detached: true`, `stdio: 'pipe'`
- `waitForReady(handle: FlutterRunHandle, options?: FlutterRunWaitOptions): Promise<void>` — scan stdout for "Flutter run key commands" signal
- `stopFlutterRun(handle: FlutterRunHandle): Promise<void>` — kill by PID, never throws
- `withFlutterRun(options, callback): Promise<T>` — high-level wrapper with try/finally

Implementation details:
- Use `spawn('flutter', ['run', '-d', serial, '--pid-file', pidFile])` with `detached: true`
- Listen on `child.stdout` for the line containing "Flutter run key commands" — this is the ready signal
- Default ready timeout: 120 seconds (Flutter hot reload startup can be slow on first build)
- Fallback: if signal not seen within timeout but app process is running on device, proceed with warning
- Store PID immediately after spawn for cleanup even if ready signal never arrives
- `stopFlutterRun`: try `process.kill(pid, 'SIGTERM')`, wait 5s, then `process.kill(pid, 'SIGKILL')`
- All functions accept injectable `spawnFn` and `execFn` for unit testing

**Rationale:** Follows the same pattern as `emulator.ts` from Phase 10 (injectable deps, try/finally, high-level wrapper). Separate module keeps flutter run management self-contained.

### 2. Maestro Test Execution and JUnit Parsing (MAE-01, MAE-02)
**Decision:** Create `src/uat/maestro.ts` as the Maestro orchestration module. Export:
- `runMaestroTest(options: MaestroTestOptions): Promise<MaestroResult>` — runs `maestro test --format junit --output <reportPath> <flowsDir>`
- `parseMaestroJUnit(xmlContent: string): MaestroResult` — parses JUnit XML via `junit2json`
- `reconcileResult(exitCode: number, junitResult: MaestroResult): MaestroResult` — defense-in-depth reconciliation

Defense-in-depth reconciliation logic:
1. Parse JUnit XML for actual test results (pass/fail per testcase)
2. Check exit code from `maestro test`
3. If exit code === 0 AND XML says pass → **PASS**
4. If exit code === 0 AND XML says fail → **FAIL** (trust XML over exit code)
5. If exit code !== 0 AND XML says pass → **PASS** (known Maestro regression — trust XML)
6. If exit code !== 0 AND XML says fail → **FAIL**
7. If XML is unparseable → fall back to exit code only, log warning

`MaestroResult` interface:
```typescript
interface MaestroResult {
  passed: boolean;
  totalFlows: number;
  passedFlows: number;
  failedFlows: number;
  flowResults: Array<{
    name: string;
    passed: boolean;
    durationMs: number;
    error?: string;
  }>;
}
```

**Rationale:** Research identifies Maestro 2.0.x regression (#2706) where exit code 1 is returned even when all flows pass. Defense-in-depth ensures accurate results regardless of CLI bugs.

### 3. Maestro Flow Generation Strategy (MAE-05, MAE-07)
**Decision:** The flow generation is agent-driven, not template-driven. The UAT prompt instructs the Claude agent to:
1. Generate Maestro flow YAML files in the `.maestro/` directory (configurable via `config.testing.maestroFlowsDir`)
2. Target widgets by semantic identifier (`ValueKey`, `semanticsLabel`) — NOT by coordinates or text content
3. Include `waitForAnimationToEnd` after every navigation action
4. Include `clearState` at the start of each flow for isolation
5. Use `assertVisible` with semantic identifiers for verification

The UAT prompt template for Flutter apps includes semantic identifier guidance:
```
When building the Flutter app, use Key(ValueKey('semantic-id')) on ALL interactive widgets.
When writing Maestro flows, target these widgets by their id property.
Include waitForAnimationToEnd after navigation to prevent flakiness.
```

This guidance goes into `buildUATPrompt()` in `src/uat/runner.ts` for the `"flutter"` case (already stubbed from Phase 9) AND into the phase execution context prompt so the agent builds Maestro-friendly widgets from the start.

**Rationale:** Agent-generated flows adapt to the actual app structure rather than requiring templates. Semantic identifiers are more stable than text or coordinates. `waitForAnimationToEnd` prevents the #1 Maestro flakiness issue per research.

### 4. Gap Closure Integration (MAE-06)
**Decision:** Integrate Maestro UAT with the existing gap closure loop in `runUAT()`:
1. After Maestro test execution, convert `MaestroResult.flowResults` into `WorkflowResult[]` (existing type)
2. Failed workflows trigger `runUATGapClosure()` (existing function in `src/uat/workflows.ts`)
3. Gap closure prompt includes: which Maestro flows failed, the error messages, and instructions to fix BOTH the app code AND the Maestro flow YAML
4. After gap closure, re-run Maestro test to verify fix
5. Loop until all flows pass or budget is exhausted

The key integration point is `runUAT()` in `src/uat/runner.ts`. For Flutter apps, instead of the Docker-based web UAT flow, it:
1. Ensures emulator is running (via `withEmulator` from Phase 10)
2. Starts Flutter app (via `withFlutterRun` from this phase)
3. Generates Maestro flows (via agent step)
4. Runs Maestro test (via `runMaestroTest`)
5. If failures: runs gap closure, re-runs Maestro test
6. Tears down flutter run and emulator in finally blocks

**Rationale:** Reuses existing gap closure infrastructure. The `WorkflowResult` type from `src/uat/types.ts` already supports the pass/fail/error structure that Maestro results map to.

### 5. New npm Dependency
**Decision:** Add `junit2json@3.2.0` as a production dependency. This parses Maestro's JUnit XML output into typed JavaScript objects.

**Rationale:** Purpose-built for JUnit XML parsing, has TypeScript types, ESM+CJS compatible. Writing a custom XML parser is unnecessary complexity.

### 6. UAT Runner Flutter Path (MAE-03, MAE-06)
**Decision:** Modify `runUAT()` in `src/uat/runner.ts` to branch on appType:
- For `"web"`, `"api"`, `"cli"` — existing Docker-based flow (unchanged)
- For `"flutter"` — new path: emulator + flutter run + maestro test + gap closure

The Flutter UAT path does NOT use Docker, health checks, or the curl-based polling. Instead it uses:
- `withEmulator()` for emulator lifecycle
- `withFlutterRun()` for app lifecycle
- `runMaestroTest()` for test execution
- Existing `runUATGapClosure()` for failures

**Rationale:** Flutter apps run on the emulator, not in Docker. The existing UAT runner's architecture (start app → run tests → gap closure → stop app) is preserved; only the "how" changes for each step.

### Claude's Discretion
- Exact Maestro flow YAML structure (agent decides based on app requirements)
- Whether to add `--no-ansi` flag to Maestro CLI for cleaner output parsing
- Internal log verbosity during flutter run stdout scanning
- Whether to validate generated Maestro YAML syntax before execution (optional — Maestro gives clear errors)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Forge Architecture
- `SPEC.md` — Overall Forge architecture and behavior spec
- `.planning/research/SUMMARY.md` — v1.1 research findings, Maestro patterns, pitfalls, defense-in-depth
- `.planning/REQUIREMENTS.md` — Phase 11 requirements (MAE-01 through MAE-07)
- `.planning/phases/09-flutter-verifier-infrastructure/09-CONTEXT.md` — Phase 9 decisions (AppType, verifiers)
- `.planning/phases/10-android-emulator-lifecycle/10-CONTEXT.md` — Phase 10 decisions (emulator lifecycle, withEmulator API)

### Existing Code (integration points)
- `src/uat/emulator.ts` — `withEmulator()`, `startEmulator()`, emulator lifecycle (Phase 10)
- `src/uat/emulator-types.ts` — `EmulatorHandle`, `EmulatorStartOptions`
- `src/uat/runner.ts` — `runUAT()`, `detectAppType()`, `buildUATPrompt()` (main integration target)
- `src/uat/types.ts` — `AppType`, `UATWorkflow`, `WorkflowResult`, `UATContext`
- `src/uat/workflows.ts` — `runUATGapClosure()`, `buildSafetyPrompt()`, `buildMobileSafetyBlock()`
- `src/uat/index.ts` — UAT module public API (add new exports here)
- `src/config/schema.ts` — `maestro_flows_dir` field, `ForgeConfig` interface
- `src/pipeline/pipeline-controller.ts` — `executeFromUAT()` (calls `runUAT()`)
- `src/state/schema.ts` — `ForgeStateSchema`, emulator state tracking

### External References
- [Maestro CLI Commands](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options) — `maestro test` flags, `--format junit`
- [Maestro Flutter Support](https://docs.maestro.dev/get-started/supported-platform/flutter) — semantic identifiers, element priority
- [junit2json on npm](https://www.npmjs.com/package/junit2json) — v3.2.0 API for JUnit XML parsing
- `mobile-dev-inc/maestro#2706` — `--format junit` false failure regression

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withEmulator()` in `src/uat/emulator.ts` — High-level emulator lifecycle wrapper; Phase 11 nests flutter run inside this
- `runUATGapClosure()` in `src/uat/workflows.ts` — Existing gap closure loop; works with `WorkflowResult[]`
- `buildUATPrompt()` in `src/uat/runner.ts` — Already has `"flutter"` branch with semantic identifier guidance
- `buildSafetyPrompt()` in `src/uat/workflows.ts` — Already has mobile safety guardrails
- `buildMobileSafetyBlock()` in `src/uat/workflows.ts` — Mobile-specific safety text
- `UATContext` in `src/uat/types.ts` — Injectable dependencies pattern (execFn, runStepFn, fs)

### Established Patterns
- Injectable dependencies for all I/O operations (execFn, spawnFn, fs)
- Co-located unit tests (`.test.ts` next to source files)
- `try/finally` for resource cleanup (emulator pattern from Phase 10)
- State updates via `stateManager.update()` — camelCase in TS, snake_case on disk
- Error classes extending base Error with descriptive names

### Integration Points
- `src/uat/runner.ts` — `runUAT()` needs Flutter-specific path (emulator + flutter run + maestro)
- `src/uat/index.ts` — Export new modules (flutter-run, maestro)
- `package.json` — Add `junit2json@3.2.0` dependency
- Pipeline controller calls `runUAT()` already — no changes needed at that level

</code_context>

<specifics>
## Specific Ideas

- The "Flutter run key commands" stdout signal looks like: `Flutter run key commands.` on its own line
- `flutter run -d <serial>` targets a specific emulator — use the serial from `EmulatorHandle`
- Maestro test command: `maestro test --format junit --output .forge/maestro-report.xml .maestro/`
- The JUnit XML has `<testsuite>` → `<testcase>` structure; each testcase maps to one Maestro flow
- `junit2json` returns `{ testsuite: { testcase: [...] } }` — map each testcase to a `WorkflowResult`
- The gap closure prompt for Maestro should include BOTH "fix app code" and "fix flow YAML" instructions
- Use `config.testing.maestroFlowsDir` (default `.maestro`) for flow file location
- The ready signal timeout should be separate from the boot timeout — flutter compile can take 2-3 minutes on first run

</specifics>

<deferred>
## Deferred Ideas

- Maestro Cloud integration for parallel mobile testing — v2+
- Visual regression testing via Maestro screenshots — v2+
- `assertWithAI` in generated flows — experimental, unreliable in CI
- Multiple concurrent emulator + flutter run instances — v2+
- iOS Simulator Maestro testing — Phase 12

None beyond deferred — discussion stayed within phase scope

</deferred>

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps via injectable execFn/spawnFn)
- **Integration tests** for flutter run lifecycle, Maestro JUnit parsing, result reconciliation, gap closure integration
- **Scenario tests** for full Maestro UAT lifecycle: emulator + flutter run + maestro test + gap closure → pass

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology

---

*Phase: 11-maestro-uat-integration*
*Context gathered: 2026-03-28*
