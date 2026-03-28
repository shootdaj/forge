# Phase 9 Context: Flutter Verifier Infrastructure

**Created:** 2026-03-28 (auto mode)
**Phase Goal:** Forge detects Flutter projects and runs pub get, analyze, test, and build verification without needing a device or emulator

## Domain Boundary

This phase delivers the **Flutter verifier infrastructure** — the foundational layer that all subsequent Flutter/mobile phases build on. It adds:
1. App type detection for Flutter projects (pubspec.yaml-based)
2. Four new Flutter verifiers (pub get, analyze, test, build)
3. Flutter startup lock mutex to prevent deadlock
4. Config schema extensions for mobile fields
5. Mobile safety guardrails and deployment-awareness in context prompts

**Not in scope:** Emulator lifecycle (Phase 10), Maestro UAT (Phase 11), iOS (Phase 12).

## Canonical Refs

- `SPEC.md` — Overall Forge architecture and behavior spec
- `.planning/research/SUMMARY.md` — v1.1 research findings, Flutter CLI flags, pitfalls
- `.planning/REQUIREMENTS.md` — Phase 9 requirements (DET-01 through SAF-02)
- `src/verifiers/types.ts` — VerifierResult interface, skippedResult() helper
- `src/verifiers/index.ts` — Verifier registry and orchestrator pattern
- `src/verifiers/utils.ts` — execWithTimeout() shared utility
- `src/config/schema.ts` — ForgeConfigSchema with Zod, nested defaults pattern
- `src/uat/types.ts` — AppType union, UATWorkflow, UATContext
- `src/uat/runner.ts` — detectAppType(), app type routing
- `src/pipeline/prompts.ts` — Context prompt builders

## Decisions

[auto] Selected all gray areas and auto-resolved with recommended defaults.

### 1. App Type Detection Strategy
**Decision:** Detect Flutter via `pubspec.yaml` presence in project root. Add `"flutter"` to the `AppType` union type. Detection happens in `detectAppType()` in `src/uat/runner.ts` — check for pubspec.yaml BEFORE the existing stack-based detection (Flutter projects may also have a `node` testing stack configured).

**Rationale:** pubspec.yaml is the universal marker for Dart/Flutter projects. Checking the filesystem is more reliable than relying on config.testing.stack because the user may not have configured it for Flutter.

### 2. New Verifier File Structure
**Decision:** Create four new verifier files as separate modules — NOT extending existing verifiers:
- `src/verifiers/flutter-pub-get.ts` — runs `flutter pub get`
- `src/verifiers/flutter-analyze.ts` — runs `dart analyze --fatal-warnings --format machine`
- `src/verifiers/flutter-test.ts` — runs `flutter test --machine`, parses NDJSON
- `src/verifiers/flutter-build.ts` — runs `flutter build apk --debug`

All follow the existing `Verifier` function signature: `(config: VerifierConfig) => Promise<VerifierResult>`.
All self-skip via `skippedResult()` when `pubspec.yaml` is absent from cwd.

**Rationale:** Separate files match the existing pattern (one file per verifier). Each Flutter verifier is conceptually distinct and independently testable.

### 3. Flutter Startup Lock (Mutex)
**Decision:** Create `src/verifiers/flutter-lock.ts` with a process-level mutex that serializes all Flutter CLI invocations. All four Flutter verifiers acquire this lock before running any `flutter` or `dart` CLI command.

Implementation: Simple async mutex using a promise chain pattern (no external dependency). The lock is module-level (singleton within the process).

**Rationale:** Flutter has a global startup lock (flutter/flutter#16423) that causes deadlocks when multiple flutter CLI commands run concurrently. Since Forge runs verifiers in parallel via Promise.allSettled, this mutex prevents the deadlock.

### 4. NDJSON Parsing for flutter test --machine
**Decision:** Parse stdout line-by-line, skip lines that don't start with `{` (Gradle contamination), look for the `done` event's `success` field. Also check individual `TestDoneEvent` entries for `result !== "success"`.

**Rationale:** Research confirms Gradle build output contaminates stdout (flutter/flutter#123873). Line-by-line JSON parsing with filtering is the standard approach.

### 5. Config Schema Extensions
**Decision:** Add to `TestingConfigSchema`:
- `flutter_avd_name: z.string().default("")` — AVD name for emulator (Phase 10 will use this)
- `flutter_build_flavor: z.string().default("")` — build flavor for flutter build
- `maestro_flows_dir: z.string().default(".maestro")` — directory for Maestro flow files

Add to `VerificationConfigSchema`:
- `mobile_build: z.boolean().default(false)` — toggle for flutter build verifier
- `mobile_analyze: z.boolean().default(false)` — toggle for flutter analyze verifier

Both default to false — Flutter verification is opt-in until auto-detection enables it.

**Rationale:** Follows existing pattern in schema.ts. Defaults to false so existing non-Flutter projects are unaffected.

### 6. Verifier Registry Integration
**Decision:** Register all four Flutter verifiers in `src/verifiers/index.ts`. Add config-to-registry mappings:
- `mobileBuild` -> `"flutter-build"` (gated by `mobile_build` config toggle)
- `mobileAnalyze` -> `"flutter-analyze"` (gated by `mobile_analyze` config toggle)
- `flutter-pub-get` and `flutter-test` always run when `tests` is enabled AND pubspec.yaml exists (they self-skip otherwise)

**Rationale:** Build and analyze are separate toggles (some projects may want only tests). pub get and test piggyback on the existing `tests` toggle since they're the Flutter equivalent of npm install + npm test.

### 7. Safety Guardrails
**Decision:** Add mobile-specific safety guardrails:
- No real device permissions in prompts (camera, location, contacts)
- Test Firebase projects only (no production Firebase)
- Sandbox-only push notifications
- No production signing keys or keystores

Implemented as additions to the existing `buildSafetyPrompt()` in `src/uat/workflows.ts` when appType is "flutter".

### 8. Mobile Deployment-Awareness in Context Prompts
**Decision:** Extend `buildContextPrompt()` in `src/pipeline/prompts.ts` (or create a new `buildMobileContextPrompt()`) to include:
- Signing configuration guidance (debug keystore for dev, placeholder for release)
- Bundle ID / application ID conventions
- Platform-specific build differences (Android vs iOS)
- Widget semantic identifiers for Maestro compatibility

Added when appType is detected as "flutter".

### 9. Execution Timeout
**Decision:** Flutter CLI commands get a longer timeout than web verifiers: 120 seconds for pub get, 60 seconds for analyze, 120 seconds for test, 300 seconds for build apk. Use the existing `execWithTimeout()` from `src/verifiers/utils.ts`.

**Rationale:** Flutter builds are significantly slower than web builds, especially on first run when Gradle downloads dependencies.

## Deferred Ideas

- Flutter test coverage reporting (non-blocking metric) — Phase 9+ or v1.2
- Bundle ID / signing config verifier — Phase 10+
- Flutter test pyramid enforcement — v1.2

## Specifics

- Use `dart analyze` (not `flutter analyze`) for the analyze verifier — it's faster and has `--format machine` flag
- For `flutter test --machine`, the NDJSON events follow the dart-lang/test JSON reporter spec
- The `done` event has shape: `{"type":"done","success":true/false,"time":...}`
- Filter non-JSON lines by checking if line.trimStart() starts with `{`
- The startup lock should log when it's waiting: "Waiting for Flutter startup lock..."

## Testing Requirements (AX)

All new functionality in this phase MUST include:
- **Unit tests** for all new functions/methods (mock external deps)
- **Integration tests** for all new API endpoints, DB operations, and service integrations
- **Scenario tests** for all new user-facing workflows

Test naming: `Test<Component>_<Behavior>[_<Condition>]`
Reference: TEST_GUIDE.md for requirement mapping, .claude/ax/references/testing-pyramid.md for methodology
