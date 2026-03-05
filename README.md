# Forge

Autonomous software development orchestrator built on the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk).

You give it a project spec. It gathers requirements interactively, then builds the entire system — code, tests, CI/CD, documentation — without coming back unless it genuinely needs a human (API keys, account creation, payments).

## How It Works

Forge moves orchestration into **code** instead of prompts:

- **Code decides** what runs next (deterministic pipeline, not prompt-following)
- **Code verifies** each step completed (programmatic checks, not agent self-report)
- **Code retries** on failure with error context (3-tier cascade: retry → skip → stop)
- **Code manages** context windows (fresh `query()` call per step)
- **Code enforces** budgets, timeouts, and quality gates

### The Wave Model

```
Wave 1:  Build everything → mock external services
         ↓
Checkpoint:  Batch ALL human needs into ONE pause (API keys, skipped items)
         ↓
Wave 2:  Swap mocks for real integrations, address skipped items
         ↓
Wave 3+: Spec compliance loop (verify → fix → converge)
         ↓
UAT:     Spin up the app, test like a real user (final gate)
         ↓
Done:    All requirements verified + UAT passed
```

## Install

```bash
npm install
npm run build
```

Requires Node.js >= 20 and an Anthropic API key.

## Usage

```bash
# Interactive requirements gathering
forge init

# Run all phases autonomously
forge run

# Run a single phase
forge phase 3

# Check progress
forge status

# Resume from checkpoint (after providing API keys)
forge resume --env .env.production --guidance guidance.md
```

## Architecture

```
src/
├── sdk/              # Agent SDK query() wrapper, error categorization
├── config/           # forge.config.json loading + validation
├── state/            # forge-state.json persistence, crash recovery
├── step-runner/      # Budget-enforced step execution, failure cascade
├── verifiers/        # 8 programmatic verifiers (tests, types, lint, coverage, ...)
├── phase-runner/     # Phase lifecycle (context → plan → execute → verify → gap closure)
├── pipeline/         # Wave model FSM, dependency graph, mock management, spec compliance
├── cli/              # Commander CLI, status display, git utilities, test traceability
├── requirements/     # Interactive requirements gathering across 8 categories
├── docs/             # Notion documentation management (8 mandatory pages)
└── uat/              # User acceptance testing (Docker, safety guardrails, gap closure)
```

### Key Design Decisions

- **Fresh context per step** — Each `query()` call gets its own context window. No accumulated confusion.
- **Programmatic verification** — 8 verifiers (file existence, tests, typecheck, lint, coverage, observability, Docker, deployment) run as code, not agent self-report.
- **Mock-first builds** — Wave 1 builds everything with mocks. External services are swapped in Wave 2 after the human provides credentials.
- **Convergence checking** — Spec compliance gaps must decrease each round. If they don't, Forge stops instead of looping forever.
- **UAT as final gate** — After tests pass, Forge spins up the app and tests it as a real user would (browser for web apps, HTTP for APIs, shell for CLIs).

## Configuration

Create `forge.config.json` in your project root:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_budget_total": 200,
  "max_budget_per_phase": 50,
  "max_budget_per_step": 5,
  "max_retries": 3,
  "testing": {
    "framework": "vitest",
    "unit_command": "npx vitest run",
    "typecheck_command": "npx tsc --noEmit"
  }
}
```

See `SPEC.md` for the full specification.

## Testing

```bash
# Run all 687 tests
npm test

# Typecheck
npm run typecheck
```

| Tier        | Tests | Description |
|-------------|-------|-------------|
| Unit        | 534   | Individual functions, mocked dependencies |
| Integration | 84    | Module interactions, mocked SDK |
| Scenario    | 69    | Full user workflows end-to-end |

## License

ISC
