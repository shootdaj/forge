# Stack Research

**Domain:** Autonomous CLI orchestrator (AI agent workflow management)
**Researched:** 2026-03-05
**Confidence:** HIGH (core SDK verified from official docs; supporting tools verified from npm/official sources)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | >=20 LTS | Runtime | Required by `@anthropic-ai/claude-agent-sdk`; LTS channel provides stability for long-running autonomous processes |
| TypeScript | ~5.7 | Language | Project requirement; enables type-safe SDK integration; need >=5.2 for `await using` (V2 SDK cleanup pattern) |
| `@anthropic-ai/claude-agent-sdk` | ^0.2.63 | Core dependency | THE dependency. Provides `query()` which IS Claude Code as a library -- same tools, same agent loop, fresh context per call |
| Zod | ^3.24 or ^4.3 | Schema validation | Required peer dependency of the Agent SDK (for `tool()` definitions). Also use for config validation, state schemas, and structured output schemas via `z.toJSONSchema()` |
| Commander | ^14.0 | CLI framework | 0 dependencies, 180KB install, <1ms overhead, excellent TypeScript types, 500M+ weekly downloads |
| tsup | ^8.5 | Build tool | Zero-config TypeScript bundler built on esbuild. Handles ESM+CJS dual output, generates .d.ts declarations, 100x faster than tsc for compilation |
| Vitest | ^4.0 | Test framework | Native TypeScript/ESM support without config, 10-20x faster than Jest in watch mode, vi.mock() for SDK mocking |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chalk` | ^5.4 | Terminal colors | CLI output formatting -- status messages, errors, progress indicators |
| `ora` | ^8.2 | Spinners | Long-running operations feedback (query() calls take 12s+ cold start) |
| `dotenv` | ^16.4 | Env loading | `forge resume --env .env.production` for credential loading |
| `glob` | ^11.0 | File globbing | Programmatic verifiers that need to find files by pattern |
| `execa` | ^9.5 | Process execution | Safer child_process wrapper for running `npm test`, `tsc`, `docker compose`, `git` commands in verifiers |
| `fast-json-stable-stringify` | ^2.1 | Deterministic JSON | Atomic state writes -- ensures consistent serialization for forge-state.json |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript (`tsc --noEmit`) | Type checking only | tsup handles compilation; tsc used only for type verification in CI and pre-commit |
| ESLint + `@typescript-eslint` | Linting | Standard TypeScript linting; use flat config format (eslint.config.js) |
| Prettier | Formatting | Consistent code style; integrates with ESLint via eslint-config-prettier |
| `tsx` | Dev execution | Run TypeScript directly during development without build step |

## The Agent SDK: Deep Dive

**Confidence: HIGH** -- verified against official docs at platform.claude.com/docs/en/agent-sdk/typescript (fetched 2026-03-05)

### query() Function Signature

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query; // extends AsyncGenerator<SDKMessage, void>
```

### Critical Options for Forge

```typescript
const q = query({
  prompt: "Execute phase 3...",
  options: {
    // REQUIRED for autonomous operation
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true, // Must be true when using bypassPermissions

    // REQUIRED for GSD skills and CLAUDE.md loading
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],

    // Budget and turn controls
    maxBudgetUsd: 15.00,
    maxTurns: 200,

    // Model selection
    model: "claude-opus-4-6",
    fallbackModel: "claude-sonnet-4-5-20250929",

    // Working directory
    cwd: projectDir,

    // Structured output (validated JSON at end of query)
    outputFormat: {
      type: "json_schema",
      schema: myZodSchema // via z.toJSONSchema()
    },

    // Hooks for monitoring
    hooks: {
      PostToolUse: [{
        hooks: [async (input) => {
          // Log tool usage, track progress
          return { continue: true };
        }]
      }],
      SessionEnd: [{
        hooks: [async (input) => {
          // Record session end reason
          return { continue: true };
        }]
      }]
    },

    // Subagents for parallel work within a step
    agents: {
      "test-runner": {
        description: "Runs tests in parallel",
        prompt: "Run the test suite and report results",
        tools: ["Bash", "Read", "Glob"],
        model: "sonnet",
        maxTurns: 20
      }
    },

    // Session management
    sessionId: "custom-uuid",  // For tracking
    resume: "previous-session-id", // Resume interrupted steps
    enableFileCheckpointing: true, // Enable file rewind

    // MCP servers (e.g., Notion)
    mcpServers: {
      notion: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@notionhq/notion-mcp-server"],
        env: { NOTION_TOKEN: process.env.NOTION_TOKEN }
      }
    }
  }
});
```

### Message Processing Pattern

```typescript
for await (const message of q) {
  switch (message.type) {
    case "system":
      // Init message -- tools, model, slash commands available
      break;
    case "assistant":
      // Agent response -- message.message.content has text/tool_use blocks
      // message.message.usage has token counts
      break;
    case "result":
      if (message.subtype === "success") {
        // message.result -- text result
        // message.structured_output -- validated JSON if outputFormat used
        // message.total_cost_usd -- cost tracking
        // message.num_turns -- turn count
        // message.usage -- token usage
      } else {
        // Error subtypes: error_max_turns, error_during_execution,
        //   error_max_budget_usd, error_max_structured_output_retries
        // message.errors -- array of error strings
      }
      break;
  }
}
```

### Performance Characteristics

| Scenario | Latency | Notes |
|----------|---------|-------|
| Cold start (new query) | ~12s | SDK spawns a new process per query() call |
| Warm (streaming input mode) | ~2-3s | Reuses process within a session |
| V2 session (send/stream) | ~2-3s per turn | Better for multi-turn within a step |

**Implication for Forge:** The 12s cold start per query() is acceptable because Forge runs steps sequentially with programmatic verification between them. Each step does substantial work (minutes, not seconds). Use V1 `query()` for the main pattern (one call per pipeline step). Consider V2 sessions for the interactive requirements gathering phase where multi-turn is needed.

### V2 Preview API (for multi-turn)

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt
} from "@anthropic-ai/claude-agent-sdk";

// One-shot (for simple verifications)
const result = await unstable_v2_prompt("Check if tests pass", { model: "claude-sonnet-4-5-20250929" });

// Multi-turn session (for requirements gathering)
await using session = unstable_v2_createSession({ model: "claude-opus-4-6" });
await session.send("What problem does this system solve?");
for await (const msg of session.stream()) { /* process response */ }
await session.send("Follow-up question...");
for await (const msg of session.stream()) { /* process response */ }
```

**WARNING:** V2 is labeled `unstable` -- APIs may change. Use V1 `query()` for all critical pipeline steps. V2 is only worth considering for the interactive requirements gathering mode where the session-based pattern is a cleaner fit.

### SDK Key Constraints

1. **`allowDangerouslySkipPermissions: true`** must be set alongside `permissionMode: "bypassPermissions"` -- without it, bypass mode silently fails
2. **`settingSources` defaults to `[]`** (no settings loaded) -- must explicitly opt in to load CLAUDE.md and GSD skills
3. **Zod is a peer dependency** -- SDK requires Zod ^3.24.1, but Zod 4.x is also supported (for `tool()` definitions)
4. **No hot process reuse** -- each `query()` spawns a new subprocess; budget/turn limits are per-call only
5. **`outputFormat` with `json_schema`** -- SDK validates output and retries on schema mismatch; returns `structured_output` in result message

## Installation

```bash
# Core dependencies
npm install @anthropic-ai/claude-agent-sdk commander zod

# Supporting libraries
npm install chalk ora dotenv glob execa fast-json-stable-stringify

# Dev dependencies
npm install -D typescript tsup vitest @types/node tsx eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
```

## Project Configuration

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Key choices:**
- `"module": "ESNext"` + `"moduleResolution": "bundler"` -- tsup handles the actual bundling; this gives best TypeScript DX
- `"noEmit": true` -- tsc is for type checking only; tsup compiles
- `"target": "ES2022"` -- supports `await using`, top-level await, and all modern features available in Node 20+

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  dts: true,
  shims: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node"
  }
});
```

**Key choices:**
- ESM only (no CJS) -- this is a CLI tool, not a library consumed by others
- `target: "node20"` -- matches SDK requirement
- `banner` with shebang -- makes the output directly executable

### vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts"]
    },
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
```

### package.json (key fields)

```json
{
  "name": "forge",
  "type": "module",
  "bin": {
    "forge": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  },
  "engines": {
    "node": ">=20"
  }
}
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Commander ^14 | oclif | Only if Forge grows into a plugin-based CLI ecosystem (unlikely for v1); oclif adds 12MB and 30+ deps |
| Commander ^14 | yargs | If you need extremely complex argument parsing with middleware; Commander handles Forge's 5 commands easily |
| tsup ^8.5 | esbuild (direct) | If you need fine-grained control over the build pipeline; tsup wraps esbuild with better defaults |
| tsup ^8.5 | tsc | Never for compilation -- 100x slower, no bundling. Only for type checking |
| Vitest ^4.0 | Jest 30 | If the project were React Native (Vitest doesn't support it); for a Node CLI, Vitest is strictly better |
| execa ^9.5 | child_process | If you want zero deps and are comfortable with the raw API; execa adds safety (proper signal handling, better errors) |
| Zod ^3.24/^4.3 | io-ts, superstruct | Never -- Zod is required by the Agent SDK as a peer dependency; using anything else means two validation libs |
| fs (native) + atomic-write pattern | lowdb, node-persist | If state grows beyond simple JSON (unlikely for forge-state.json); native fs with write-tmp-rename is simpler and dependency-free |
| fs (native) | SQLite (node:sqlite) | If Forge needed querying state (e.g., "find all failed phases") -- but forge-state.json is read-whole/write-whole, so SQL adds complexity without benefit |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@anthropic-ai/sdk` (raw Claude API) | Requires rebuilding all Claude Code tools (Read, Write, Edit, Bash, Glob, Grep, etc.) from scratch -- months of work | `@anthropic-ai/claude-agent-sdk` -- IS Claude Code |
| `claude -p` (headless CLI) | No programmatic message control, harder error handling, no structured output, no hooks | Agent SDK `query()` |
| Jest | Requires babel/ts-jest transforms for TypeScript, no native ESM, 10-20x slower than Vitest in watch mode | Vitest |
| Webpack/Rollup | Massive overkill for a CLI tool; designed for browser bundles | tsup (wraps esbuild) |
| tsc (for compilation) | No bundling, no shebang injection, 100x slower than esbuild-based tools | tsup (compilation) + tsc (type checking only) |
| lowdb/node-persist | Extra dependency for what amounts to `JSON.parse(fs.readFileSync())` + `fs.writeFileSync()` with a temp file | Native `fs` with write-rename pattern |
| dockerode | Adds a dependency for what Forge does via `execa("docker compose up -d")` -- Forge shells out to Docker, it doesn't need programmatic container management | `execa` to run `docker compose` CLI commands |
| AX (prompt orchestration) | Stochastic failure modes -- agent can skip steps, self-report false success, accumulate context degradation | Code-based orchestration with Agent SDK |

## Stack Patterns by Variant

**For pipeline steps (build, execute, verify):**
- Use V1 `query()` with `permissionMode: "bypassPermissions"`
- One query per step, fresh context
- Use `outputFormat` with Zod schemas for structured step results
- Process `SDKResultMessage` for cost tracking and error handling

**For interactive requirements gathering (`forge init`):**
- Consider V2 `unstable_v2_createSession()` for cleaner multi-turn pattern
- OR use V1 with streaming input (`AsyncIterable<SDKUserMessage>`)
- User responses fed back into the session
- Longer session, higher turn limits

**For programmatic verification (post-step):**
- No SDK calls -- pure Node.js code
- `execa` for running `npm test`, `tsc --noEmit`, `docker compose`, `git log`
- `fs` for checking file existence
- Parse JSON test output, exit codes, git logs

**For state persistence:**
- Native `fs.writeFileSync` + `fs.renameSync` (atomic write pattern)
- Zod schemas for runtime validation on load
- camelCase in TypeScript, snake_case in JSON via serialize/deserialize layer

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@anthropic-ai/claude-agent-sdk` ^0.2.63 | Node.js >=18 (>=20 recommended), Zod ^3.24.1 or ^4.x | SDK peer-depends on Zod; supports both v3 and v4 |
| Commander ^14 | Node.js >=20 | Commander 14 dropped Node 18 support |
| tsup ^8.5 | Node.js >=18 | Uses esbuild internally |
| Vitest ^4.0 | Node.js >=18 | Requires Vite 7 internally (handled as dependency) |
| TypeScript ~5.7 | All above | Need >=5.2 for `await using` if using V2 SDK cleanup |
| Zod ^3.24 | Agent SDK ^0.2.x | Stable, widely used; `z.toJSONSchema()` available in Zod 4 |
| Zod ^4.3 | Agent SDK ^0.2.x | Newer, supports `z.toJSONSchema()` natively; breaking changes from v3 |

**Zod version decision:** Use Zod 3.x (^3.24) for stability. The Agent SDK explicitly lists `zod@^3.24.1` as a peer dependency. While it supports Zod 4, sticking with v3 avoids migration friction. Zod 3 can generate JSON Schemas via `zodToJsonSchema` (from the `zod-to-json-schema` package) for structured outputs.

**Update (if using Zod 4):** Zod 4 has native `z.toJSONSchema()` which eliminates the need for `zod-to-json-schema`. If the Agent SDK's Zod 4 compatibility is confirmed working, prefer Zod 4 for the cleaner API.

## Docker Integration Strategy

**Do NOT use dockerode or any Docker SDK library.** Forge interacts with Docker the same way a developer does: by running `docker compose` commands. The spec's verifiers call `docker compose up -d`, `docker compose run --rm test`, and `docker compose down`.

```typescript
import { execa } from "execa";

// Forge's Docker verifier
async function dockerSmokeTest(): Promise<{ passed: boolean; details: string }> {
  try {
    await execa("docker", ["compose", "up", "-d"]);
    const { exitCode } = await execa("docker", ["compose", "run", "--rm", "test"]);
    return { passed: exitCode === 0, details: "Docker smoke test passed" };
  } catch (e) {
    return { passed: false, details: e.stderr };
  } finally {
    await execa("docker", ["compose", "down"]);
  }
}
```

This is simpler, has zero additional dependencies, and is exactly what the spec describes.

## Sources

- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full API reference, verified 2026-03-05 (HIGH confidence)
- [Agent SDK Structured Outputs](https://platform.claude.com/docs/en/agent-sdk/structured-outputs) -- outputFormat, Zod integration (HIGH confidence)
- [Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) -- createSession/resumeSession API (MEDIUM confidence -- unstable preview)
- [SDK Performance Issue #34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) -- 12s cold start per query(), streaming input workaround (HIGH confidence)
- [Commander.js npm](https://www.npmjs.com/package/commander) -- v14.0.3, 0 dependencies (HIGH confidence)
- [tsup npm](https://www.npmjs.com/package/tsup) -- v8.5.1 (HIGH confidence)
- [Vitest npm](https://www.npmjs.com/package/vitest) -- v4.0.18 (HIGH confidence)
- [Zod npm](https://www.npmjs.com/package/zod) -- v4.3.6 (v3 at ^3.24) (HIGH confidence)
- [npm-compare commander vs yargs vs oclif](https://npm-compare.com/commander,oclif,vorpal,yargs) -- Weekly downloads, dependency counts (MEDIUM confidence)
- [Vitest vs Jest comparison](https://dev.to/saswatapal/why-i-chose-vitest-over-jest-10x-faster-tests-native-esm-support-13g6) -- Performance benchmarks (MEDIUM confidence)

---
*Stack research for: Forge autonomous development orchestrator*
*Researched: 2026-03-05*
