# Phase 4: Programmatic Verifiers - Research

**Researched:** 2026-03-05
**Domain:** Deterministic code verification / CLI output parsing / Registry pattern
**Confidence:** HIGH

## Summary

Phase 4 implements a registry of deterministic verifiers that programmatically check build artifacts -- files exist, tests pass, types check, lint clean, tests cover new code, observability present, Docker builds, deployment configs valid. The verifiers replace agent self-report with code-based evidence, which is Forge's core differentiator.

The implementation is straightforward: each verifier is a pure async function that shells out to a CLI tool or inspects the filesystem, parses the output, and returns a structured result. The registry manages execution (parallel with Docker gated). No external libraries are needed beyond Node.js builtins (`child_process`, `fs`, `path`) -- the complexity is in parsing heterogeneous CLI output formats correctly.

**Primary recommendation:** Implement each verifier as an isolated async function matching a common `Verifier` interface, with a thin registry layer that handles enable/disable, parallel execution, and aggregation. Use `child_process.execFile` (or `exec` for shell commands) with timeouts. Parse vitest JSON output for tests, regex for tsc errors, exit codes for lint/docker. Keep verifiers stateless -- they receive config and return results.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Common `Verifier` interface: `(config: VerifierConfig) => Promise<VerifierResult>`
- `VerifierResult` has: `passed: boolean`, `verifier: string`, `details: string[]`, `errors: string[]`
- Each verifier is a standalone function, registered in a verifier registry
- Registry provides `runAll()` which runs all enabled verifiers via `Promise.all` (except Docker, which runs after others pass)
- **8 verifier types:** files (VER-01), tests (VER-02), typecheck (VER-03), lint (VER-04), coverage (VER-05), observability (VER-06), docker (VER-07), deployment (VER-08)
- Verifiers enabled/disabled via `forge.config.json` verification section
- If prerequisites not met, verifier is automatically skipped (not failed)
- Default enabled: files, tests, typecheck, lint, coverage. Default disabled: observability, docker, deployment
- `VerificationReport` includes summary: total run, passed, failed, skipped
- Test verifier should support vitest, jest, mocha JSON output
- Coverage verifier handles `src/foo.ts` -> `src/foo.test.ts` or `test/foo.test.ts`
- All verifiers have timeouts (30s default, 120s for docker)

### Claude's Discretion
- Exact file patterns for coverage verifier (which directories to scan)
- Observability verifier heuristics (what constitutes "structured logging")
- Docker health check timeout values
- Whether to use `child_process.exec` or `child_process.spawn` for command execution

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VER-01 | Files verifier checks expected files exist via fs.existsSync() | Trivial -- use `fs.existsSync()` or `fs.accessSync()`. No research needed beyond stdlib. |
| VER-02 | Tests verifier runs test command, parses JSON output for pass/fail counts | Vitest JSON reporter format verified via live test run. Schema documented below with exact field names. |
| VER-03 | Typecheck verifier runs tsc --noEmit and reports errors | tsc output format verified. Pattern: `file(line,col): error TSxxxx: message`. Use `--pretty false` for parseable output. Exit code 2 on errors. |
| VER-04 | Lint verifier runs lint command and reports errors | Lint commands use exit code 0/1. Capture stderr/stdout. No special parsing needed beyond error count from output. |
| VER-05 | Test coverage verifier checks new source files have corresponding test files | Use `git diff --name-only --diff-filter=A` to detect new files. Map source files to test paths using configurable patterns. |
| VER-06 | Observability verifier checks health endpoint, structured logging, error logging | Heuristic-based: grep source for health route patterns, check for JSON logger imports, grep error handlers for log calls. |
| VER-07 | Docker verifier runs docker compose smoke tests | Use `docker compose up --wait` for health-check-aware startup. Timeout at 120s. Clean up with `docker compose down`. |
| VER-08 | Deployment verifier checks Dockerfile builds, env vars consistent, deploy config valid | Parse `.env.example` for var names, compare against Dockerfile ENV/ARG and docker-compose.yml environment sections. Check Dockerfile exists and `docker build --check` or dry-run. |
| VER-09 | All verifiers run in parallel (Promise.all), docker runs after others pass | Registry `runAll()` uses `Promise.allSettled()` for non-docker, then conditionally runs docker. Collect all results regardless of individual failures. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | Node 20+ | Run CLI commands (tsc, vitest, eslint, docker) | Stdlib -- zero dependencies, well-tested, universal |
| `node:fs` | Node 20+ | File existence checks, file reading | Stdlib |
| `node:path` | Node 20+ | Path manipulation for test file mapping | Stdlib |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.3.6 (already installed) | Validate verifier config schemas | Already a project dependency -- use for input validation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.exec` | `execa` (npm) | execa adds promise-based API + better error handling, but adds a dependency for something Node stdlib handles fine |
| Manual tsc parsing | `typescript` compiler API | TS compiler API gives structured diagnostics but is heavy (40MB+) and couples to specific TS version. Regex on CLI output is simpler and version-agnostic |
| Manual env parsing | `dotenv` (npm) | dotenv can parse .env files, but we only need key extraction which is trivial with regex |

**Installation:**
No new packages needed. Everything uses Node.js stdlib + already-installed `zod`.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── verifiers/
│   ├── index.ts           # Verifier registry + runAll() + types
│   ├── types.ts           # VerifierResult, VerifierConfig, VerificationReport
│   ├── files.ts           # File existence verifier (VER-01)
│   ├── tests.ts           # Test runner + JSON parser (VER-02)
│   ├── typecheck.ts       # tsc --noEmit verifier (VER-03)
│   ├── lint.ts            # Lint command verifier (VER-04)
│   ├── coverage.ts        # Test coverage verifier (VER-05)
│   ├── observability.ts   # Health endpoint + logging verifier (VER-06)
│   ├── docker.ts          # Docker compose smoke test (VER-07)
│   ├── deployment.ts      # Dockerfile + env var verifier (VER-08)
│   └── utils.ts           # Shared exec helpers with timeout
```

### Pattern 1: Verifier Interface (Locked Decision)

**What:** Each verifier is a standalone async function with a common signature.
**When to use:** Every verifier follows this pattern.

```typescript
// Types (from CONTEXT.md decisions)
interface VerifierResult {
  passed: boolean;
  verifier: string;       // e.g., "files", "tests", "typecheck"
  details: string[];      // Human-readable descriptions of what was checked
  errors: string[];       // Specific failure messages with paths/line numbers
}

interface VerifierConfig {
  cwd: string;                    // Project working directory
  forgeConfig: ForgeConfig;       // Full Forge config (has testing/verification sections)
  expectedFiles?: string[];       // For files verifier
  gitRef?: string;                // For coverage verifier (compare against)
}

type Verifier = (config: VerifierConfig) => Promise<VerifierResult>;
```

### Pattern 2: Registry with Parallel Execution

**What:** A registry object maps verifier names to functions, `runAll()` handles execution strategy.
**When to use:** The single entry point for all verification.

```typescript
interface VerificationReport {
  passed: boolean;            // Overall: all non-skipped verifiers passed
  results: VerifierResult[];  // Individual results
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  durationMs: number;
}

// Registry pattern
const verifierRegistry: Record<string, Verifier> = {
  files: filesVerifier,
  tests: testsVerifier,
  typecheck: typecheckVerifier,
  lint: lintVerifier,
  coverage: coverageVerifier,
  observability: observabilityVerifier,
  docker: dockerVerifier,
  deployment: deploymentVerifier,
};

async function runAll(config: VerifierConfig): Promise<VerificationReport> {
  const enabled = getEnabledVerifiers(config.forgeConfig);
  const nonDocker = enabled.filter(v => v !== "docker");
  const dockerEnabled = enabled.includes("docker");

  // Phase 1: run non-docker in parallel
  const results = await Promise.allSettled(
    nonDocker.map(name => verifierRegistry[name](config))
  );
  // ... aggregate results ...

  // Phase 2: run docker only if all others passed
  if (dockerEnabled && allOthersPassed) {
    const dockerResult = await verifierRegistry.docker(config);
    // ... add to results ...
  }

  return report;
}
```

### Pattern 3: Command Execution with Timeout

**What:** Shared utility for running CLI commands with timeout, capturing stdout/stderr.
**When to use:** Every verifier that shells out (tests, typecheck, lint, docker, deployment).

```typescript
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execWithTimeout(
  command: string,
  cwd: string,
  timeoutMs: number = 30_000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    // exec rejects on non-zero exit code but still has stdout/stderr
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.code ?? 1,
    };
  }
}
```

### Pattern 4: Skip When Prerequisites Not Met

**What:** If a verifier's prerequisites are missing (no tsconfig, no docker-compose.yml), return a "skipped" result instead of failing.
**When to use:** Every verifier should check prerequisites first.

```typescript
function skippedResult(verifierName: string, reason: string): VerifierResult {
  return {
    passed: true,  // skipped counts as "not failed"
    verifier: verifierName,
    details: [`Skipped: ${reason}`],
    errors: [],
  };
}
```

### Anti-Patterns to Avoid
- **Coupling verifiers to each other:** Each verifier must be independently callable. No verifier should depend on another verifier's output.
- **Swallowing stderr:** Always capture and include stderr in error details. Silent failures are worse than noisy ones.
- **Tight timeout coupling:** Don't hardcode timeouts. Make them configurable through VerifierConfig or ForgeConfig.
- **Parsing colored output:** Always use `--no-color` / `--pretty false` / `NO_COLOR=1` when shelling out to CLI tools. Colored output contains ANSI escape codes that break regex parsing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON test output parsing | Custom test runner | vitest/jest `--reporter=json` | Standardized format, handles edge cases |
| TypeScript type checking | Custom TS checker | `tsc --noEmit --pretty false` | Handles all TS complexity, project refs, etc. |
| Docker health checks | Custom polling loop | `docker compose up --wait` | Built-in health check support since compose v2 |
| .env file parsing | Custom parser | Simple key extraction regex | `.env.example` only needs key names, not values |

**Key insight:** Every verifier delegates the hard work to an established CLI tool and only parses the output. The verifiers are parsers and reporters, not reimplementations.

## Common Pitfalls

### Pitfall 1: Vitest JSON Output to stderr vs stdout
**What goes wrong:** Vitest may write JSON to stdout or stderr depending on configuration. When using `--reporter=json` with `--outputFile`, the JSON goes to the file. Without `--outputFile`, it goes to stdout -- but if tests fail, error messages might mix into the stream.
**Why it happens:** Vitest's behavior differs between run modes and reporter configurations.
**How to avoid:** Use `--outputFile` to write JSON to a temp file, then read the file. This avoids stdout/stderr mixing issues entirely.
**Warning signs:** JSON.parse fails on what should be valid JSON output.

### Pitfall 2: tsc Exit Codes and Error Counting
**What goes wrong:** Assuming exit code 1 means errors. Actually, tsc uses exit code 2 for compilation errors and exit code 1 for general failures (like invalid flags).
**Why it happens:** Non-standard exit code convention.
**How to avoid:** Parse the output text for `error TS\d+` patterns to count errors. Use exit code only as a boolean signal (0 = clean, non-zero = check output).
**Warning signs:** Error count of 0 when exit code is non-zero.

### Pitfall 3: child_process Buffer Overflow
**What goes wrong:** `exec()` has a default 1MB `maxBuffer`. Large test suites or verbose tsc output exceeds this, causing `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
**Why it happens:** Default buffer is too small for real-world projects.
**How to avoid:** Set `maxBuffer: 10 * 1024 * 1024` (10MB) explicitly on every exec call.
**Warning signs:** Command fails with buffer error despite the underlying tool succeeding.

### Pitfall 4: ANSI Color Codes in Parseable Output
**What goes wrong:** CLI tools add color codes by default when they detect a TTY. Even with `exec()` (which is not a TTY), some tools still colorize based on env vars.
**Why it happens:** Tools use different heuristics for color detection.
**How to avoid:** Set `env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" }` in exec options. Also use tool-specific flags: `tsc --pretty false`, `eslint --no-color`.
**Warning signs:** Regex patterns don't match output that visually looks correct.

### Pitfall 5: Git Diff Base Reference
**What goes wrong:** Using `HEAD~1` or `HEAD` as diff base misses files that were added across multiple commits in a phase.
**Why it happens:** Phase execution may span many commits.
**How to avoid:** Use a configurable base ref (e.g., `main` or the branch point). The coverage verifier should accept a `gitRef` parameter. Default to `main` (the merge target).
**Warning signs:** Coverage verifier misses files added in earlier commits of the same phase.

### Pitfall 6: Docker Compose Cleanup on Error
**What goes wrong:** If docker compose up succeeds but the test command fails, containers are left running. Next run fails because ports are occupied.
**Why it happens:** Error path doesn't clean up.
**How to avoid:** Always run `docker compose down` in a `finally` block, regardless of test outcome.
**Warning signs:** "port already in use" errors on subsequent runs.

### Pitfall 7: Promise.allSettled vs Promise.all for Verifiers
**What goes wrong:** Using `Promise.all` means the first verifier failure rejects the entire batch, losing results from other verifiers.
**Why it happens:** `Promise.all` short-circuits on first rejection.
**How to avoid:** Use `Promise.allSettled` to collect ALL results, then aggregate. A single verifier crash should not prevent other verifiers from reporting.
**Warning signs:** Missing results in the verification report when one verifier throws.

## Code Examples

Verified patterns from live testing in the Forge project:

### Vitest JSON Reporter Output (Verified via `npx vitest run --reporter=json`)
```typescript
// Actual output format from vitest 4.x with --reporter=json
// Top-level fields relevant for VER-02:
interface VitestJsonOutput {
  numTotalTestSuites: number;
  numPassedTestSuites: number;
  numFailedTestSuites: number;
  numPendingTestSuites: number;
  numTotalTests: number;
  numPassedTests: number;     // <-- check numPassedTests > 0
  numFailedTests: number;     // <-- check numFailedTests === 0
  numPendingTests: number;
  numTodoTests: number;
  success: boolean;
  startTime: number;
  testResults: Array<{
    assertionResults: Array<{
      ancestorTitles: string[];
      fullName: string;
      status: "passed" | "failed" | "pending";
      title: string;
      duration: number;
      failureMessages: string[];
    }>;
  }>;
}

// This is Jest-compatible -- the same parser works for both vitest and jest
```

### tsc --noEmit Error Output (Verified via live test)
```typescript
// tsc output format with --pretty false:
// file(line,col): error TSxxxx: message
// Example: "src/foo.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'."
// Exit code: 0 = success, 2 = compilation errors

const TSC_ERROR_REGEX = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm;

function parseTscOutput(output: string): { errorCount: number; errors: string[] } {
  const errors: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = TSC_ERROR_REGEX.exec(output)) !== null) {
    errors.push(`${match[1]}:${match[2]}:${match[3]} - ${match[4]}: ${match[5]}`);
  }
  return { errorCount: errors.length, errors };
}
```

### Git Diff for New File Detection (Verified via live test)
```bash
# Detect files added since branching from main:
git diff --name-only --diff-filter=A main...HEAD

# Output: one file path per line
# src/config/config.test.ts
# src/config/index.ts
# src/config/loader.ts
```

```typescript
// In Node.js:
function getNewFiles(cwd: string, baseRef: string = "main"): string[] {
  const { stdout } = execSync(
    `git diff --name-only --diff-filter=A ${baseRef}...HEAD`,
    { cwd, encoding: "utf-8" }
  );
  return stdout.trim().split("\n").filter(Boolean);
}
```

### Docker Compose Smoke Test Pattern
```typescript
async function dockerSmokeTest(
  cwd: string,
  composeFile: string,
  timeoutMs: number = 120_000,
): Promise<VerifierResult> {
  const composeCmd = `docker compose -f ${composeFile}`;

  try {
    // Start with health check awareness
    await execWithTimeout(`${composeCmd} up --wait`, cwd, timeoutMs);

    // Run test service if defined
    const testResult = await execWithTimeout(
      `${composeCmd} run --rm test`,
      cwd,
      timeoutMs,
    );

    return {
      passed: testResult.exitCode === 0,
      verifier: "docker",
      details: ["Docker compose smoke test executed"],
      errors: testResult.exitCode !== 0
        ? [`Test service failed: ${testResult.stderr}`]
        : [],
    };
  } finally {
    // Always clean up
    await execWithTimeout(`${composeCmd} down --volumes --remove-orphans`, cwd, 30_000);
  }
}
```

### Observability Heuristic Checks
```typescript
// Grep-based observability detection
// These are heuristics, not guarantees

// 1. Health endpoint: look for route registration patterns
const HEALTH_PATTERNS = [
  /app\.(get|use)\s*\(\s*['"`]\/health['"`]/,
  /router\.(get|use)\s*\(\s*['"`]\/health['"`]/,
  /\.get\s*\(\s*['"`]\/healthz?['"`]/,
  /healthCheck/,
];

// 2. Structured logging: look for JSON logger imports
const STRUCTURED_LOG_PATTERNS = [
  /require\s*\(\s*['"`](pino|winston|bunyan|structured-log)['"`]\s*\)/,
  /import\s+.*from\s+['"`](pino|winston|bunyan)['"`]/,
  /createLogger/,
  /Logger\s*\(/,
];

// 3. Error logging: look for catch blocks with log calls
const ERROR_LOG_PATTERNS = [
  /catch\s*\(.*\)\s*\{[^}]*log(ger)?\.(error|warn)/,
  /\.catch\s*\(.*=>.*log/,
];
```

### Env Var Consistency Check
```typescript
// Parse .env.example for required variable names
function parseEnvExample(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter(line => line.trim() && !line.startsWith("#"))
    .map(line => line.split("=")[0].trim())
    .filter(Boolean);
}

// Parse Dockerfile for ENV and ARG declarations
function parseDockerfileVars(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const vars: string[] = [];
  const envRegex = /^(?:ENV|ARG)\s+(\w+)/gm;
  let match;
  while ((match = envRegex.exec(content)) !== null) {
    vars.push(match[1]);
  }
  return vars;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Promise.all` for parallel work | `Promise.allSettled` for fault-tolerant parallel | ES2020 | Collect all verifier results even when some throw |
| `docker-compose` (v1, Python) | `docker compose` (v2, Go plugin) | 2023 | Use `docker compose` (space, not hyphen) in all commands |
| Custom health polling loops | `docker compose up --wait` | Compose v2.1+ | Built-in health-check-aware startup |
| vitest `--reporter json` (v1) | vitest `--reporter=json` (v4) | vitest 2.0+ | Same Jest-compatible output, stable across versions |

**Deprecated/outdated:**
- `docker-compose` (hyphenated): Use `docker compose` (space) -- the Go-based compose plugin
- `child_process.exec` without timeout: Always pass explicit timeout to prevent hung processes

## Open Questions

1. **Verifier Config Extensibility**
   - What we know: Current `ForgeConfig.verification` only has boolean toggles (typecheck, lint, docker_smoke, test_coverage_check, observability_check). The files verifier needs `expectedFiles` which isn't in config.
   - What's unclear: Should `expectedFiles` come from the step runner context (per-step verification) or from config?
   - Recommendation: The `VerifierConfig` parameter is the right place -- it's passed per-invocation. The phase runner (Phase 5) will provide `expectedFiles` when calling verifiers after a step. Config only controls enable/disable.

2. **Config Schema Update Needed**
   - What we know: Current `VerificationConfigSchema` has 5 toggles. But there are 8 verifiers (files, tests, typecheck, lint, coverage, observability, docker, deployment). Files and tests are always-on by default. Missing explicit toggles for files and tests.
   - What's unclear: Should files and tests be toggleable, or always enabled?
   - Recommendation: Add `files` and `tests` toggles to verification config with `default: true`. Also add `deployment` toggle with `default: false`. Update the `VerificationConfigSchema` and `ForgeConfig` interface.

3. **Test Framework Detection**
   - What we know: Config has `testing.unitCommand` which defaults to `npm test -- --json`. The test verifier should parse JSON output from this command.
   - What's unclear: How to handle frameworks that don't support `--json` natively (e.g., mocha needs `mocha --reporter json`).
   - Recommendation: The test verifier should try to parse the output as JSON. If parsing fails, fall back to exit-code-only verification (exit 0 = passed, non-zero = failed). This handles unknown frameworks gracefully.

4. **Lint Command Variability**
   - What we know: Config defaults to `eslint src/`. Different projects use different linters (eslint, biome, oxlint).
   - What's unclear: Whether to parse lint-specific output or just use exit codes.
   - Recommendation: Use exit code as primary signal. Capture stdout/stderr for error reporting. Don't attempt to parse lint-specific JSON formats -- too many variants.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `/Users/anshul/Anshul/Code/forge/vitest.config.ts` |
| Quick run command | `npx vitest run src/verifiers/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VER-01 | Files verifier checks expected files exist | unit | `npx vitest run src/verifiers/files.test.ts -t "VER-01"` | Wave 0 |
| VER-02 | Tests verifier runs test command, parses JSON | unit + integration | `npx vitest run src/verifiers/tests.test.ts -t "VER-02"` | Wave 0 |
| VER-03 | Typecheck verifier runs tsc --noEmit | unit + integration | `npx vitest run src/verifiers/typecheck.test.ts -t "VER-03"` | Wave 0 |
| VER-04 | Lint verifier runs lint command | unit + integration | `npx vitest run src/verifiers/lint.test.ts -t "VER-04"` | Wave 0 |
| VER-05 | Coverage verifier checks test file correspondence | unit | `npx vitest run src/verifiers/coverage.test.ts -t "VER-05"` | Wave 0 |
| VER-06 | Observability verifier checks health + logging | unit | `npx vitest run src/verifiers/observability.test.ts -t "VER-06"` | Wave 0 |
| VER-07 | Docker verifier runs compose smoke test | unit (mocked exec) | `npx vitest run src/verifiers/docker.test.ts -t "VER-07"` | Wave 0 |
| VER-08 | Deployment verifier checks Dockerfile + env vars | unit | `npx vitest run src/verifiers/deployment.test.ts -t "VER-08"` | Wave 0 |
| VER-09 | Parallel execution with docker gated | unit + integration | `npx vitest run src/verifiers/index.test.ts -t "VER-09"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/verifiers/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/verifiers/types.ts` -- Verifier types, VerifierResult, VerificationReport
- [ ] `src/verifiers/utils.ts` -- Shared exec helper with timeout
- [ ] `src/verifiers/index.ts` -- Registry + runAll()
- [ ] `src/verifiers/files.test.ts` -- covers VER-01
- [ ] `src/verifiers/tests.test.ts` -- covers VER-02
- [ ] `src/verifiers/typecheck.test.ts` -- covers VER-03
- [ ] `src/verifiers/lint.test.ts` -- covers VER-04
- [ ] `src/verifiers/coverage.test.ts` -- covers VER-05
- [ ] `src/verifiers/observability.test.ts` -- covers VER-06
- [ ] `src/verifiers/docker.test.ts` -- covers VER-07
- [ ] `src/verifiers/deployment.test.ts` -- covers VER-08
- [ ] `src/verifiers/index.test.ts` -- covers VER-09 (parallel execution)
- [ ] `test/integration/verifiers.test.ts` -- integration tests
- [ ] `test/scenarios/verifiers.test.ts` -- scenario tests

## Implementation Guidance

### exec vs spawn Decision (Claude's Discretion)

**Recommendation: Use `child_process.exec` (promisified) for all verifiers.**

Rationale:
- All verifier commands are short-lived (not streaming)
- Output fits in memory (10MB buffer is generous)
- `exec` provides simpler API: returns `{ stdout, stderr }` directly
- Shell interpretation is fine -- we're running user-configured commands
- `spawn` would add complexity (stream handling) for no benefit here

The one exception would be if a verifier needed real-time output streaming, but none do -- all verifiers wait for completion and parse the final output.

### Coverage Verifier File Patterns (Claude's Discretion)

**Recommendation:**

Source file detection:
- Scan `src/` directory by default
- Exclude patterns: `*.test.ts`, `*.spec.ts`, `*.d.ts`, `index.ts` (barrel files), `types.ts` (pure type files)
- Only count `.ts`, `.tsx`, `.js`, `.jsx` files

Test file mapping (check in order):
1. `src/foo.test.ts` (co-located)
2. `src/foo.spec.ts` (co-located, alt naming)
3. `test/foo.test.ts` (separate test dir, flat)
4. `test/unit/foo.test.ts` (separate test dir, tiered)

A source file needs at least ONE matching test file to pass.

### Observability Heuristics (Claude's Discretion)

**Recommendation: Three-check heuristic with configurable strictness.**

1. **Health endpoint** (HIGH confidence): Grep all `.ts`/`.js` files for route patterns registering `/health` or `/healthz`. This is reliable -- if the pattern exists, a health endpoint was registered.

2. **Structured logging** (MEDIUM confidence): Check for imports of known structured loggers (pino, winston, bunyan) OR presence of `JSON.stringify` in logging-related code. Less reliable -- projects may use custom loggers.

3. **Error logging** (MEDIUM confidence): Grep catch blocks and error handlers for `.error(` or `log.error(` calls. Heuristic -- may have false positives/negatives.

Report all three checks individually in `details`. Only fail if health endpoint is missing (the most critical and reliably detectable check). Warn (but pass) on missing structured logging or error logging.

### Docker Health Check Timeouts (Claude's Discretion)

**Recommendation:**
- `docker compose up --wait` timeout: **120 seconds** (covers slow image builds)
- Individual service health check: **30 seconds** (configured in docker-compose.yml, not our responsibility)
- `docker compose down` cleanup: **30 seconds**
- Total docker verifier budget: **180 seconds max**

### Config Schema Updates Needed

The current `VerificationConfigSchema` needs expansion to match the 8 verifiers:

```typescript
// Current (missing files, tests, deployment):
const VerificationConfigSchema = z.object({
  typecheck: z.boolean().default(true),
  lint: z.boolean().default(true),
  docker_smoke: z.boolean().default(true),
  test_coverage_check: z.boolean().default(true),
  observability_check: z.boolean().default(true),
});

// Proposed update:
const VerificationConfigSchema = z.object({
  files: z.boolean().default(true),           // VER-01
  tests: z.boolean().default(true),           // VER-02
  typecheck: z.boolean().default(true),       // VER-03
  lint: z.boolean().default(true),            // VER-04
  test_coverage_check: z.boolean().default(true),  // VER-05
  observability_check: z.boolean().default(false), // VER-06 (disabled by default)
  docker_smoke: z.boolean().default(false),   // VER-07 (disabled by default)
  deployment: z.boolean().default(false),     // VER-08 (disabled by default)
});
```

Note: The CONTEXT.md says "Default: files, tests, typecheck, lint, coverage enabled. Observability, docker, deployment disabled by default." This differs from the current schema where docker_smoke and observability_check default to `true`. The CONTEXT.md decisions take precedence.

### Integration with Existing Step Runner

The existing `StepOptions.verify` callback in `src/step-runner/types.ts` is `() => Promise<boolean>`. The verifiers produce `VerifierResult[]`. The Phase Runner (Phase 5) will bridge these by:
1. Running verifiers after a step
2. Mapping `VerificationReport.passed` to the boolean the step runner expects
3. Storing the full `VerificationReport` for gap closure context

This phase does NOT need to modify the step runner. It only needs to export a clean API that Phase 5 can consume.

## Sources

### Primary (HIGH confidence)
- Live `npx vitest run --reporter=json` output from the Forge project -- verified exact JSON schema fields
- Live `npx tsc --noEmit --pretty false` output -- verified error format and exit codes
- Live `git diff --name-only --diff-filter=A` output -- verified new file detection
- Node.js child_process documentation: [https://nodejs.org/api/child_process.html](https://nodejs.org/api/child_process.html)
- Vitest reporters documentation: [https://vitest.dev/guide/reporters](https://vitest.dev/guide/reporters)

### Secondary (MEDIUM confidence)
- Docker Compose health check patterns: [https://github.com/peter-evans/docker-compose-healthcheck](https://github.com/peter-evans/docker-compose-healthcheck)
- Docker Compose `--wait` flag: [https://www.kenmuse.com/blog/waiting-for-docker-compose-up/](https://www.kenmuse.com/blog/waiting-for-docker-compose-up/)
- TypeScript tsc CLI options: [https://www.typescriptlang.org/docs/handbook/compiler-options.html](https://www.typescriptlang.org/docs/handbook/compiler-options.html)

### Tertiary (LOW confidence)
- Observability heuristic patterns: based on training data knowledge of common Node.js logging patterns. Should be validated against real project structures during implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all Node.js stdlib, no new dependencies, verified via live testing
- Architecture: HIGH - registry + parallel pattern is well-established, decisions locked in CONTEXT.md
- Pitfalls: HIGH - verified through live experimentation (vitest JSON format, tsc output format, exec behavior)
- Observability heuristics: MEDIUM - grep-based detection is inherently heuristic, will need tuning

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain -- Node.js stdlib and CLI tool output formats change slowly)
