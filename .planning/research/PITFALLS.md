# Pitfalls Research

**Domain:** Autonomous AI coding orchestrator (Claude Agent SDK)
**Researched:** 2026-03-05
**Confidence:** HIGH (official SDK docs verified, StrongDM learnings documented, community issues confirmed)

## Critical Pitfalls

### Pitfall 1: Agent SDK Process Spawn Overhead (~12s per query)

**What goes wrong:**
Every `query()` call spawns a fresh Claude Code process. This takes ~12 seconds of cold-start overhead regardless of task complexity. For Forge's architecture where each step is a separate `query()` call, a pipeline with 50+ steps incurs 10+ minutes of pure initialization overhead. Worse, running 3 concurrent phases means 3 concurrent process spawns competing for system resources.

**Why it happens:**
The Agent SDK is architecturally a wrapper around Claude Code CLI, not a pure API library. Each `query()` call spawns a new Node.js subprocess that initializes the full Claude Code environment. There is no hot process reuse or daemon mode (feature requested in [issue #33](https://github.com/anthropics/claude-agent-sdk-typescript/issues/33), not yet implemented).

**How to avoid:**
- Use session resumption (`resume` option with session IDs) to keep a warm process for multi-turn interactions within a single step. Subsequent messages within a session drop to ~2-3s.
- Batch small related operations into single `query()` calls instead of one-call-per-operation. A "plan phase" step can include context gathering + planning in one call rather than two.
- Accept the 12s overhead as a fixed cost per step; design step granularity accordingly (fewer, bigger steps rather than many tiny ones).
- Do NOT attempt to work around this by using the raw Anthropic Messages API -- you would lose all Claude Code built-in tools.

**Warning signs:**
- Pipeline taking 30+ minutes with most time spent on initialization.
- Performance profiling shows `query()` call setup dwarfing actual agent work for simple steps.

**Phase to address:**
Step Runner implementation (Phase 2). The step runner must be designed with this overhead in mind. Step granularity decisions cascade through the entire system.

---

### Pitfall 2: The Circularity Problem -- Same Model Writes Code and Tests

**What goes wrong:**
When the same Claude model writes both the implementation code and the test code, they share identical blind spots. If the model misunderstands a requirement or edge case, it bakes that misunderstanding into both the production code AND the test, which passes but the system is wrong. StrongDM documented this concretely: agents wrote `return true` to satisfy narrowly formulated tests. Tests pass, production breaks.

**Why it happens:**
The builder and the verifier share the same training data, the same reasoning patterns, and the same documentation interpretation. Without external diversity in the verification signal, the system converges on internally consistent but externally incorrect results.

**How to avoid:**
- Forge's programmatic verification is the primary defense. Code-based checks (fs.existsSync, test runner exit codes, typecheck, lint) cannot be "fooled" by a model.
- For test quality: the spec compliance loop should verify requirement acceptance criteria against ACTUAL behavior (curl the endpoint, check the response), not just "test file exists."
- UAT is critical -- it tests from outside the model's perspective by exercising the actual application.
- Consider StrongDM's "holdout set" pattern: define some acceptance criteria that are NOT shown to the building agent, only to the verification step.
- Never let the gap closure agent both diagnose AND verify its own fix. The verification must always be programmatic.

**Warning signs:**
- All tests pass on first attempt (suspiciously clean).
- Test assertions are tautological (testing that code returns what code returns).
- Spec compliance loop converges in round 1 with no gaps (should be skeptical).

**Phase to address:**
Verifiers implementation (Phase 3). This is the most critical phase. Every verifier must check REAL outcomes, not model-reported outcomes. The UAT phase design must also address this.

---

### Pitfall 3: State Corruption from Concurrent Phase Writes

**What goes wrong:**
When running 3 phases concurrently (as the spec allows via `Promise.all`), all three phases read `forge-state.json`, modify their portion, and write back. Without synchronization, writes clobber each other: Phase 2 finishes, writes state, then Phase 3 finishes and writes its state -- overwriting Phase 2's results. Node.js `fs.writeFile` is NOT atomic on most filesystems.

**Why it happens:**
The spec says "Merge results into state AFTER all concurrent phases complete (avoid race condition)" but this is easier said than done. If any phase crashes mid-execution, partial state updates may be lost. Multiple concurrent `query()` calls may also write to the same project files (git conflicts, shared config files).

**How to avoid:**
- Implement a state manager with a mutex/lock around all state writes. Use a file-based lock (`proper-lockfile` npm package) or an in-memory mutex since Forge is a single Node.js process.
- Write state using atomic file operations: write to a temp file, then rename (rename is atomic on POSIX). Never write directly to `forge-state.json`.
- Each concurrent phase should accumulate its own results in memory or a phase-specific temp file, then merge into the main state file sequentially after all phases in a wave complete.
- Use `git worktrees` for concurrent phases modifying the same repo, or ensure phase file scopes never overlap.

**Warning signs:**
- `forge-state.json` shows stale phase data after concurrent execution.
- Resume after crash shows phases as "pending" that were actually completed.
- Git merge conflicts between concurrent phase branches.

**Phase to address:**
State Manager implementation (Phase 1). This must be designed for concurrency from day one, not retrofitted. The Pipeline Controller (Phase 5) depends on this.

---

### Pitfall 4: Budget Enforcement Has a Gap Between Check and Spend

**What goes wrong:**
The spec checks budget BEFORE starting a step (`if (state.totalBudgetUsed >= config.maxBudgetTotal)`), but a step can consume its entire per-step budget ($15 default) before the check runs again. If totalBudgetUsed is $190 and maxBudgetTotal is $200, the next step passes the check but may spend $15, bringing total to $205 -- 2.5% over budget. Worse: the SDK's `maxBudgetUsd` parameter is a "target rather than a strict limit" for extended thinking, meaning actual spend can exceed the cap.

**Why it happens:**
Budget enforcement operates at two levels with a gap between them: (1) Forge's own pre-step check, which is coarse-grained, and (2) the SDK's `maxBudgetUsd`, which may not be a hard stop. The SDK reports `total_cost_usd` on the result message, but by then the money is already spent.

**How to avoid:**
- Set per-step `maxBudgetUsd` to `min(config.maxBudgetPerStep, config.maxBudgetTotal - state.totalBudgetUsed)` -- dynamically reduce the per-step cap as you approach total budget.
- Track cost incrementally using the SDK's per-step usage data (TypeScript SDK exposes per-step token breakdowns on each assistant message). Update running totals during streaming, not just at the end.
- Add a safety margin: set the internal budget limit 10% below the advertised limit so overruns stay within bounds.
- Handle the `error_max_budget_usd` result subtype gracefully -- partial work may exist and should be verified.

**Warning signs:**
- Total spend exceeds configured max_budget_total.
- Steps routinely hit their maxBudgetUsd limit (indicates steps are too large or prompts are too broad).
- Cost tracking shows 0 for completed steps (cost data not being captured from result messages).

**Phase to address:**
Cost Controller implementation (Phase 2, alongside Step Runner). Budget enforcement must be baked into the step runner from the start.

---

### Pitfall 5: Mock Drift -- Mocks That Don't Match Real APIs in Wave 2

**What goes wrong:**
Wave 1 builds everything with mocks for external services (Stripe, AWS, etc.). Wave 2 swaps mocks for real implementations. But the mock behavior drifts from the real API: different response shapes, missing error cases, auth flows that work differently in reality. The entire integration layer, tested and "verified" in Wave 1, breaks in Wave 2. This is not a minor fix -- it can require rewriting entire integration paths.

**Why it happens:**
Mocks are written by an AI agent that has training-data-level knowledge of APIs, not current-version knowledge. The mock interface may match the TypeScript types but miss runtime behaviors: rate limits, pagination cursors, webhook signature verification, OAuth refresh flows, error response formats.

**How to avoid:**
- TypeScript interfaces are necessary but not sufficient. The interface guarantees shape, not behavior.
- Use contract tests: define expected request/response pairs from official API documentation and verify both mock AND real implementations satisfy them.
- Tag mock limitations explicitly: `// MOCK LIMITATION: does not simulate rate limiting` so Wave 2 knows what to expect.
- During Wave 2, run the same test suite against both mock and real to surface behavioral differences before swapping.
- Prioritize official SDK client libraries (e.g., `stripe` npm package) over hand-written API calls -- they encode correct behavior.

**Warning signs:**
- Wave 2 integration tests fail on real APIs despite Wave 1 tests passing with mocks.
- Mock implementations are simpler than expected (happy-path only).
- No mock implementation for error cases, auth flows, or pagination.

**Phase to address:**
Mock Strategy implementation (Phase 4, External Service Mocking). Contract test infrastructure must be built alongside mocks. Wave 2 integration phase must have its own dedicated verification cycle.

---

### Pitfall 6: Verification That Doesn't Actually Verify

**What goes wrong:**
Verification checks pass but don't prove correctness. Examples: (1) `fs.existsSync(file)` -- file exists but is empty or has wrong content. (2) `npm test -- --json` exits 0 but the JSON shows skipped tests counted as "passing." (3) `git log` shows commits exist but they contain no meaningful changes. (4) Test coverage shows 100% but tests have no assertions. The system reports "all verified" while the codebase is broken.

**Why it happens:**
Verification is hard. The spec's pseudocode verifiers check necessary conditions but not sufficient conditions. Existence checks, exit code checks, and count checks are easy to implement but easy to game (intentionally or not by the AI agent).

**How to avoid:**
- Layer verification: existence check AND content validation AND behavioral test.
- For test verification: parse the JSON output fully -- check `numPassedTests > 0` (not just `numFailedTests === 0`), check `numPendingTests === 0`, check that test count increased from last phase.
- For file verification: check file size > minimum threshold, parse and validate structure (e.g., PLAN.md must have specific sections).
- For git verification: check diff stats (insertions > 0), not just commit existence.
- For typecheck/lint: capture stderr and verify it's truly clean (some tools exit 0 with warnings).
- Run verification in a clean environment (fresh Docker container) to catch "works on my machine" issues.

**Warning signs:**
- Verification always passes (never catches real issues -- means it's too permissive).
- Gap closure loop converges in 1 round (verification wasn't catching the real gaps).
- Manual inspection reveals issues that programmatic verification missed.

**Phase to address:**
Verifiers implementation (Phase 3). Every verifier needs both positive checks (thing exists, tests pass) AND negative checks (thing isn't trivial, tests aren't empty). Build verification tests that intentionally verify the verifiers themselves.

---

### Pitfall 7: `bypassPermissions` Safety and Subagent Inheritance

**What goes wrong:**
Setting `permissionMode: "bypassPermissions"` gives the agent full system access: it can run ANY bash command, write to ANY file, access the network, and delete files. Critically, all subagents inherit this mode and it CANNOT be overridden. A subagent spawned for "documentation updates" has the same unrestricted system access as the main execution agent. The `allowedTools` parameter does NOT constrain this mode -- every tool is approved regardless.

**Why it happens:**
The SDK's permission model is hierarchical with the strongest mode winning. `bypassPermissions` was designed for fully trusted environments, but in an autonomous orchestrator, different steps have very different trust requirements (a test runner should not be able to delete source files).

**How to avoid:**
- Use `bypassPermissions` only for execution steps that genuinely need full system access.
- For verification steps, use `acceptEdits` or `default` mode with explicit `allowedTools` lists.
- Use `disallowedTools` (checked before permission mode) to block specific dangerous tools even in bypass mode. Example: `disallowedTools: ["Bash"]` for read-only analysis steps.
- Set `allowDangerouslySkipPermissions: true` explicitly (required safety flag) -- this forces conscious acknowledgment.
- Consider running execution steps in Docker containers to sandbox the blast radius.

**Warning signs:**
- Agent running unexpected bash commands during verification-only steps.
- Files modified outside the expected phase scope.
- Network calls to unexpected endpoints.

**Phase to address:**
Step Runner implementation (Phase 2). Permission mode should be configurable per step type, not globally set for all steps.

---

### Pitfall 8: Crash Recovery Loses In-Flight Work

**What goes wrong:**
Forge crashes mid-phase (OOM, power loss, SIGKILL). The agent had made 15 commits and was running tests. `forge-state.json` still shows the phase as "in_progress" because state was being updated in memory, not yet flushed. On resume, Forge re-runs the entire phase from scratch, redoing all 15 commits' worth of work (doubling cost) or worse -- the re-execution creates conflicts with the existing partial work.

**Why it happens:**
The spec describes file-based checkpoints (CONTEXT.md, PLAN.md exist -> skip those steps) but execution checkpoints within a phase are not persisted. The query() call is atomic from Forge's perspective -- it either completes or it doesn't.

**How to avoid:**
- Flush state to disk after EVERY significant state change, not just at phase boundaries. Use write-ahead logging pattern: write intended change, then execute, then mark complete.
- Leverage the SDK's session management: capture `session_id` from the init message and store it. On crash recovery, resume the session with `resume: sessionId` to continue from where the agent left off.
- Check git status on resume: if the phase branch has commits, use them as a checkpoint. Don't re-execute work that's already committed.
- Use `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` to flush state on graceful shutdown.

**Warning signs:**
- `forge-state.json` last modified timestamp is much older than the last git commit.
- Resume after crash duplicates commits (same requirement IDs, different SHAs).
- State shows 0 budget used for phases that clearly consumed resources.

**Phase to address:**
State Manager (Phase 1) and Step Runner (Phase 2). Session ID capture must be in the step runner. State persistence strategy must be crash-safe from the start.

---

### Pitfall 9: Context Window Exhaustion Within a Step

**What goes wrong:**
A single `query()` call for a complex execution step accumulates context as the agent reads files, makes edits, and runs commands. The 200K token context window fills up. Once full, the agent loses earlier context (files it read, decisions it made) and starts making contradictory changes or hallucinating file contents. The SDK may truncate older messages silently.

**Why it happens:**
The spec's "fresh context per step" design mitigates cross-step accumulation, but within a single step, context still grows. A phase execution step that creates 20+ files, runs multiple test suites, and does gap closure within a single query() call can easily exceed 200K tokens.

**How to avoid:**
- Keep individual steps focused: execute code, verify code, fix gaps should be SEPARATE query() calls, not one mega-call.
- Use `maxTurns` to cap how long any single query() call can run (prevents infinite tool-use loops).
- Avoid injecting entire file contents into prompts -- reference file paths and let the agent read them (reads are cached).
- Monitor token usage via the per-step usage data and log warnings when approaching 80% of context window.
- For large phases, break execution into sub-steps (e.g., "implement backend", "implement frontend", "write tests" as separate query() calls).

**Warning signs:**
- Agent starts hallucinating file contents or forgetting earlier changes within a single step.
- Agent creates duplicate files or overwrites its own recent work.
- Step cost is disproportionately high (lots of tokens consumed aimlessly).

**Phase to address:**
Step Runner (Phase 2) and Phase Runner (Phase 4). Step granularity design is critical. The phase runner must decompose phases into appropriately-sized steps.

---

### Pitfall 10: Spec References Pseudocode API That Doesn't Match Real SDK

**What goes wrong:**
The SPEC.md was written before the SDK was fully stable. It uses pseudocode like `query({ prompt, options: { maxBudgetUsd, permissionMode, maxTurns, model, agents } })` but the actual SDK API has different parameter nesting, additional required flags (`allowDangerouslySkipPermissions`), and features not anticipated by the spec (hooks, plugins, effort levels, structured outputs, sandbox settings). Building directly from the spec's code blocks produces code that doesn't compile.

**Why it happens:**
The spec explicitly warns about this ("code blocks are pseudocode") but during implementation it's easy to cargo-cult the spec's patterns without verifying against current SDK docs.

**How to avoid:**
- Treat the SPEC.md as a behavior specification, not an API reference. The prose describes WHAT to build; the SDK docs describe HOW to call the API.
- Before writing any code, build a minimal proof-of-concept that exercises the actual SDK: spawn a query, capture the session ID, track cost, handle permissions, parse messages.
- Maintain a mapping document: "SPEC concept -> actual SDK API" for the team.
- Key differences to verify immediately:
  - `systemPrompt` requires `{ type: "preset", preset: "claude_code" }` for CC behavior
  - `settingSources` must include `"project"` to load CLAUDE.md
  - `allowDangerouslySkipPermissions: true` is required for bypass mode
  - `agents` uses `tools` not `allowedTools` for subagent tool definitions
  - Cost tracking uses `total_cost_usd` on result messages, not a callback

**Warning signs:**
- TypeScript compilation errors referencing SDK types.
- Runtime errors about unknown options or missing required fields.
- Features described in spec don't work as expected.

**Phase to address:**
Phase 0 / POC (before any real implementation). The CLAUDE.md build strategy mandates this: "Research the Agent SDK's actual TypeScript API... Build a minimal proof-of-concept... Only THEN start building the full pipeline."

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skipping session ID capture | Simpler step runner | Cannot resume crashed steps; must re-execute entirely | Never -- session IDs are trivial to capture |
| Single global permission mode | Less configuration | Cannot restrict verification steps; security risk | Only during initial POC |
| In-memory-only state | Faster, no I/O | Any crash loses all progress | Never for production; acceptable for unit tests |
| Hardcoded step budgets | Quick to implement | Cannot adapt to phase complexity; wastes money on simple steps or underbudgets complex ones | Only as initial defaults; must be configurable |
| Skipping test output parsing (exit code only) | Simpler verification | Skipped tests counted as passing; empty test suites pass; no failure diagnostics | Never -- JSON parsing is straightforward |
| Mocking query() with static responses | Fast tests | Mocks drift from real SDK behavior; false confidence | Acceptable for unit tests, but need integration tests against real SDK |
| Sequential-only phase execution | Avoids concurrency bugs | 3x slower execution for independent phases | Acceptable for v1, but design state for concurrency |

## Integration Gotchas

Common mistakes when connecting to the Claude Agent SDK and external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Agent SDK `query()` | Assuming `allowedTools` restricts available tools in bypass mode | `allowedTools` only pre-approves; use `disallowedTools` to actually block tools |
| Agent SDK cost tracking | Summing per-message usage without deduplicating by message ID | Parallel tool calls produce duplicate usage data; deduplicate by `message.message.id` |
| Agent SDK sessions | Not capturing session ID from init message | Listen for `message.type === "system" && message.subtype === "init"` to get `session_id` |
| Agent SDK system prompt | Passing a string for system prompt | Use `{ type: "preset", preset: "claude_code" }` to get Claude Code's full system prompt with tools |
| Agent SDK settings | Expecting CLAUDE.md to be loaded automatically | Must set `settingSources: ["user", "project", "local"]` explicitly |
| Docker test harness | Using fixed ports in docker-compose.test.yml | Use dynamic port allocation or Docker-internal DNS to avoid port conflicts in CI |
| Git concurrent phases | Running phases on same branch | Use separate `phase-N` branches and merge after verification |
| Notion MCP | Assuming Notion API is available without auth setup | Notion integration requires OAuth or API key setup during `forge init`, not during execution |

## Performance Traps

Patterns that work at small scale but fail as project complexity grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running ALL verifiers after EVERY step | Verification takes longer than execution | Run relevant verifiers only; full suite only at phase completion | >10 verifiers, >20 steps per phase |
| Injecting full REQUIREMENTS.md into every prompt | Token waste, context dilution | Inject only relevant requirements for current phase/step | >20 requirements, >5 phases |
| Sequential gap closure (one gap at a time) | Spec compliance loop takes hours | Batch independent gap fixes into parallel steps | >5 gaps per compliance round |
| Full `docker compose up/down` per verification | 30-60s overhead per cycle | Keep harness running between verifications; only restart on config change | >3 verification cycles per phase |
| Loading entire forge-state.json for every operation | I/O bottleneck, parse overhead | Cache in memory, flush periodically; only read from disk on startup/resume | State file >1MB (many phases, detailed mock registry) |
| Re-reading all phase checkpoints on resume | Slow startup, unnecessary I/O | Index checkpoint status in state file; only read individual files when needed | >10 phases with full checkpoint directories |

## Security Mistakes

Domain-specific security issues for an autonomous coding agent.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing API keys in forge-state.json | Credentials persisted in plaintext in project directory | Read from environment/env file at runtime; never persist credentials in state |
| `bypassPermissions` with network access | Agent could exfiltrate code, credentials, or project data | Use `disallowedTools` to block WebSearch/WebFetch during execution steps; sandbox in Docker |
| Running `forge resume --env .env.production` with real credentials | Agent has production credentials + full system access | Use test/sandbox credentials where possible; production keys only for deployment verification |
| Trusting agent-generated test fixtures | Agent could create fixtures that match its broken implementation | Derive test fixtures from requirements/acceptance criteria, not from implementation |
| Agent modifying forge-state.json | Agent could mark its own phase as "completed" without doing work | Make forge-state.json read-only from agent's perspective; only orchestrator code writes state |
| No audit trail for agent actions | Cannot determine what the agent did or why | Log all query() prompts, tool calls, and responses; maintain execution history |

## UX Pitfalls

User experience issues for Forge's CLI interface and human checkpoints.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Human checkpoint with no progress indication | User doesn't know if Forge is stuck or working | Show phase-by-phase progress with estimated time remaining |
| Cryptic error messages from SDK | User gets raw error traces, doesn't know what to do | Wrap SDK errors with actionable context: "Step X failed because Y. Run `forge resume` to retry." |
| No way to skip/defer items during resume | User must provide ALL credentials to continue | Allow partial resume: `forge resume --skip stripe` to defer specific services |
| forge status shows only state file data | User can't see what's actively happening | Show real-time agent status (current step, current phase, token usage) via stdout |
| Budget exceeded with no warning | User discovers $200 spend after the fact | Show running cost in status output; warn at 50%, 75%, 90% of budget |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Step Runner:** Has `query()` call working -- verify it also captures session ID, tracks cost per step, handles `error_max_budget_usd` and `error_max_turns` result subtypes, and flushes state to disk
- [ ] **Verifier "tests pass":** Checks exit code 0 -- verify it also parses JSON output for `numFailedTests === 0 && numPassedTests > 0 && numPendingTests === 0`
- [ ] **Phase Runner "plan verified":** Has plan file -- verify plan checker validates requirement coverage, test task presence, AND execution order (not just file existence)
- [ ] **Concurrent phases:** Uses `Promise.all` -- verify state merge happens AFTER all phases complete, not during, and handles the case where one phase throws
- [ ] **Mock registry:** Records mock files -- verify both mock and real implementations satisfy the same TypeScript interface AND contract tests
- [ ] **Cost tracking:** Reads `total_cost_usd` from result -- verify it deduplicates parallel tool call usage by message ID and handles both success and error results
- [ ] **Crash recovery:** Checks for existing CONTEXT.md/PLAN.md -- verify it also checks git log for partial execution work AND captures session ID for query() resumption
- [ ] **Budget enforcement:** Checks total before step -- verify per-step maxBudgetUsd is dynamically reduced as total approaches limit
- [ ] **Docker smoke test:** Runs `docker compose up` -- verify it uses project-specific compose project name to avoid conflicts, and ALWAYS runs `docker compose down` in finally block
- [ ] **Permission mode:** Sets `bypassPermissions` -- verify it also sets `allowDangerouslySkipPermissions: true` (required safety flag)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| State corruption from concurrent writes | LOW | Rebuild state from git history + phase checkpoint files; state is derived, not primary |
| Budget overrun (10-20% over limit) | LOW | Accept the cost; fix the budget enforcement logic; no data loss |
| Mock drift discovered in Wave 2 | MEDIUM | Run contract tests to identify specific drift points; fix mock OR real impl to match interface; re-run integration tests |
| Verification false positive (shipped broken code) | MEDIUM | Add stricter verification checks; re-run spec compliance loop with enhanced verifiers; manual review of affected code |
| Agent corrupted project files | HIGH | Use git to restore to last known-good commit; re-run affected phase; ensure `forge-state.json` is not checked into git repo being built |
| Context window exhaustion mid-step | MEDIUM | Step is likely partially complete; resume with session ID if available; otherwise re-run with smaller step scope |
| Crash with no state flush | MEDIUM | Reconstruct state from phase checkpoint files + git log; session IDs lost means steps cannot be resumed |
| Circularity (model-generated tests all pass but code is wrong) | HIGH | Manual review needed; add holdout acceptance criteria; implement external validation (e.g., different model for verification) |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Process spawn overhead | Step Runner (Phase 2) | Benchmark: measure actual query() initialization time; assert step count is reasonable |
| Circularity problem | Verifiers (Phase 3) | Intentionally introduce bugs in test fixtures; verify verifiers catch them |
| State corruption | State Manager (Phase 1) | Stress test: simulate concurrent writes; verify state consistency |
| Budget gap | Cost Controller (Phase 2) | Unit test: verify per-step budget reduces dynamically; simulate near-limit scenarios |
| Mock drift | Mock Strategy (Phase 4) | Contract test infrastructure: verify mock and real share identical test suite |
| Verification false positives | Verifiers (Phase 3) | "Verifier tests": craft intentionally broken code/tests; verify verifiers reject them |
| bypassPermissions scope | Step Runner (Phase 2) | Integration test: verify verification steps cannot write files outside scope |
| Crash recovery | State Manager (Phase 1) + Step Runner (Phase 2) | Kill process mid-phase; verify resume reconstructs correct state |
| Context exhaustion | Step Runner (Phase 2) + Phase Runner (Phase 4) | Monitor token usage; assert steps stay below 80% of context window |
| Spec vs SDK mismatch | POC / Phase 0 | Compile and run against real SDK before writing any production code |

## Sources

- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Official API docs confirming Options interface, permission modes, cost tracking (HIGH confidence)
- [Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) -- Official permission mode documentation, `allowDangerouslySkipPermissions` requirement (HIGH confidence)
- [Agent SDK Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) -- Official cost tracking docs, `total_cost_usd`, deduplication requirements (HIGH confidence)
- [SDK Issue #34: ~12s overhead per query()](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) -- Confirmed process spawn overhead, no daemon mode (HIGH confidence)
- [SDK Issue #33: Daemon Mode Feature Request](https://github.com/anthropics/claude-agent-sdk-typescript/issues/33) -- Confirms hot process reuse not implemented (HIGH confidence)
- [StrongDM Attractor](https://github.com/strongdm/attractor) -- Circularity problem, test gaming, holdout sets (HIGH confidence)
- [Simon Willison on StrongDM Dark Factory](https://simonwillison.net/2026/Feb/7/software-factory/) -- Lessons learned from Level 4 autonomous coding (HIGH confidence)
- [Docker Compose Port Conflicts](https://www.markcallen.com/preventing-port-conflicts-in-docker-compose-with-dynamic-ports/) -- Dynamic port allocation for test isolation (MEDIUM confidence)
- [Node.js Race Conditions](https://nodejsdesignpatterns.com/blog/node-js-race-conditions/) -- File write race conditions in concurrent Node.js (HIGH confidence)
- [API Mock Drift](https://dev.to/copyleftdev/title-when-swagger-lies-fixing-api-drift-before-it-breaks-you-ijo) -- Contract testing to prevent mock drift (MEDIUM confidence)
- [Claude Code Issue #10388: Token Usage API](https://github.com/anthropics/claude-code/issues/10388) -- Token tracking infrastructure gaps (MEDIUM confidence)
- [Agent Budget Guard MCP](https://earezki.com/ai-news/2026-03-02-i-built-an-mcp-server-so-my-ai-agent-can-track-its-own-spending/) -- Community pattern for agent cost tracking (LOW confidence)
- [Claude Code Issue #20264: Restrictive permissions for subagents](https://github.com/anthropics/claude-code/issues/20264) -- Confirms subagent permission inheritance limitation (HIGH confidence)

---
*Pitfalls research for: Autonomous AI Coding Orchestrator (Forge)*
*Researched: 2026-03-05*
