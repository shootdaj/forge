# Feature Research

**Domain:** Autonomous software development orchestrator (Dark Factory / Level 4 coding agent)
**Researched:** 2026-03-05
**Confidence:** HIGH (core features well-understood from spec + competitor analysis), MEDIUM (some competitor capabilities based on marketing claims)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that every autonomous coding orchestrator must have. Without these, Forge is not viable as a "walk away and come back to working software" tool.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Autonomous code generation from spec | Core promise of the tool. Devin, Cursor Cloud Agents, Codex all do this. If Forge can't generate code autonomously, it has no reason to exist. | HIGH | Forge uses Agent SDK query() per step with fresh context. This is well-designed in SPEC.md. |
| Programmatic verification (not self-report) | StrongDM's Attractor proved that agent self-report is unreliable. Cursor Cloud Agents self-test. Codex runs in sandboxes. Code-based verification is the minimum standard for trust. | MEDIUM | Forge's verifier pattern (files, tests, typecheck, lint, coverage, docker) is comprehensive. This is Forge's strongest design element. |
| Test generation alongside code | All serious agents (Devin, Cursor, Codex) generate tests. "Tests pass" is the primary feedback loop in 2026 agentic coding. Without automated test generation, verification has nothing to verify. | MEDIUM | Forge enforces test pyramid (unit/integration/scenario) per phase. Stronger than most competitors. |
| State persistence and resumability | Long-running autonomous processes crash, get interrupted, or hit budget limits. Codex sessions resume. Devin maintains machine snapshots. State loss means restarting hours of work. | MEDIUM | forge-state.json + file-based phase checkpoints. Well-designed in spec. |
| Cost/budget controls | Autonomous agents can burn tokens fast. Claude Code, Codex, and Devin all have budget/ACU tracking. Without hard stops, a runaway agent wastes hundreds of dollars. | LOW | Per-step maxBudgetUsd + total project budget with hard stop. Simple and effective. |
| CLI interface with status reporting | Developer tooling. Every competitor (Claude Code, Codex CLI, Cursor) has clear status/progress reporting. Users need to know what happened while they were away. | LOW | forge init/run/phase/status/resume. Standard CLI patterns. |
| Retry with different approaches | Self-healing is table stakes in 2026. Devin's "dynamic re-planning" and Cursor's iterative debugging are expected. A single failure should not stop the pipeline. | MEDIUM | Three-tier cascade: retry(3x different approach) -> skip and flag -> stop. Well-designed. |
| Error context propagation | When retrying, the agent must know what failed and why. All major agents (Devin 3.0, Cursor, Claude Code) do this. Blind retries waste budget. | LOW | Forge passes error output + previous attempts into retry prompts. |
| Parallel execution | Cursor Cloud Agents run in parallel. Codex runs multiple agents on worktrees. Devin spins up multiple Devins. Sequential-only execution is unacceptably slow for real projects. | HIGH | Three levels of parallelism: verification, within-phase subagents, across-phase concurrent query() calls. Complex but spec'd. |
| External service mock/stub pattern | Real projects need Stripe, AWS, SendGrid. Building against mocks is standard practice even without agents. Agents that try to use real APIs during dev will fail immediately. | MEDIUM | Interface/mock/real/factory pattern with mock registry. Systematic swap in Wave 2. Novel and well-designed. |

### Differentiators (Competitive Advantage)

Features that set Forge apart from Devin, Cursor, Codex, and even Attractor. These are what make Forge worth building.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Wave model execution (build-with-mocks -> human-checkpoint -> real-integration -> spec-compliance) | **No competitor has this.** Devin pauses for each external service. Cursor expects you to provide credentials upfront. Codex sandboxes but doesn't batch human needs. Forge builds the entire codebase with mocks first, batches ALL human needs into ONE interruption, then integrates. This maximizes autonomous progress and minimizes human involvement. | HIGH | This is Forge's single most important differentiator. The wave model is the architectural insight that makes "walk away" viable. |
| Deep interactive requirements gathering (25+ topics, structured R1/R2 format) | Devin takes a task description. Cursor takes a prompt. Codex takes an issue. None of them do structured requirements elicitation across 8 categories with acceptance criteria, edge cases, performance targets, security notes, and observability. Kiro comes closest with EARS notation, but Kiro's specs drive individual features, not entire systems. Forge's requirements doc drives the ENTIRE autonomous build. | HIGH | Quality of requirements = quality of output. This is the "garbage in, garbage out" prevention mechanism. |
| Spec compliance loop with convergence checking | Attractor has convergence-until-termination in its graph. But Forge's compliance loop is more explicit: verify every requirement has passing tests, check gap count is decreasing each round, stop if not converging. This prevents infinite loops AND ensures completeness. | MEDIUM | gap_history tracking with monotonic decrease requirement is elegant. If gaps >= prev_gaps, stop and report. |
| Code-based orchestration (not prompt-based) | Attractor uses DOT graph specs interpreted by LLM. AX uses markdown instructions. Forge uses TypeScript code that calls query() programmatically. Code can't be hallucinated away; it runs deterministically. The LLM only does focused work, never decides what to do next. | MEDIUM | This is the core architectural differentiator vs Attractor (graph-based) and AX (prompt-based). |
| Batched human checkpoint | When Forge needs human input, it presents everything at once: credentials needed, skipped items needing guidance, design decisions. One interruption, not many. No competitor batches human needs this comprehensively. | MEDIUM | Includes signup URLs, what was tried, code so far, and a single resume command. Excellent UX design. |
| Requirement traceability matrix (TEST_GUIDE.md) | Every requirement mapped to unit/integration/scenario tests. git log --grep "R5" shows all commits for requirement R5. No competitor provides this level of traceability from requirements through commits to tests. | MEDIUM | Created during scaffolding, updated per phase, verified by Forge. Powerful for auditing. |
| Plan verification gates | Before executing any phase, code validates: requirement coverage, test task presence, execution order, success criteria, no scope creep. If the plan is bad, Forge loops back. No competitor validates plans before executing them. | MEDIUM | This prevents the "agent wrote a plan then ignored half of it" failure mode. |
| UAT as final gate (actually use the app) | Tests passing does not mean the app works. Forge spins up the full stack and walks through user workflows (browser automation for web, HTTP requests for API, shell for CLI). Cursor Cloud Agents record video demos, which is similar but less systematic. | HIGH | Requires application-type-specific testing strategies. Web apps need headless browser; APIs need HTTP clients. |
| Root cause diagnosis before gap closure | When tests fail, Forge doesn't just retry. It runs a diagnostic step that categorizes the failure (wrong approach, missing dependency, integration mismatch, requirement ambiguity, environment issue) and creates a targeted fix plan. | MEDIUM | Prevents "retry the same thing 3 times" waste. Each retry is a different, informed approach. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but would hurt Forge if built.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Web UI / dashboard | Users want to see progress in a browser, like Devin's IDE view | Forge is a CLI tool for developers. Building a web UI quadruples scope, introduces its own bugs, and distracts from the core value (autonomous building). Devin has 50+ engineers building their web IDE. Forge has... not that. | Rich CLI output with forge status. Consider a TUI (terminal UI) later if demand exists. Notion docs serve as the "dashboard" for completed work. |
| Model-agnostic / multi-model support | Users want to use GPT-5, Gemini, etc. | Forge is built on the Claude Agent SDK which provides Claude Code as a library. Supporting other models means rebuilding the entire tool ecosystem (file editing, bash, search). The SDK IS the value. | Support the Agent SDK's model options (Opus, Sonnet). Don't abstract the LLM layer. |
| Real-time streaming progress UI | Users want to watch the agent work in real-time, like Cursor's editor | Forge runs unattended by design. Real-time streaming implies someone is watching. If someone is watching, they should use Claude Code directly. | Log to file. Provide forge status for async checking. Keep the "walk away" philosophy. |
| Plugin/extension system | Users want to extend Forge with custom verifiers, steps, etc. | Premature abstraction. The verifier set and pipeline structure need to stabilize before being made extensible. Plugins introduce compatibility surfaces and testing burden. | Hard-code verifiers in v1. Make the code modular so plugins are possible in v2, but don't build the plugin API yet. |
| Learning across projects | Users want Forge to get better over time by remembering past projects | Cross-project learning requires data storage, retrieval, relevance scoring, and privacy boundaries. Massive scope increase for uncertain value. StrongDM explicitly does NOT do this -- each factory run is independent. | Each project starts fresh. If patterns emerge, encode them in Forge's code (not in a learning database). |
| Deployment to production | Users want Forge to deploy the code it builds | Forge builds deployment configs (Dockerfile, CI/CD, vercel.json) but should NOT push to production. Autonomous deployment of autonomously-generated code is a liability nightmare. The human gate between "built" and "deployed" is a feature, not a limitation. | Build all deployment artifacts. Verify they work. Stop before git push to prod. |
| Agent-authored PR reviews / code review | Users want AI code review like Cursor's BugBot | Forge's code is already verified by programmatic checks, test pyramid, and UAT. Adding an LLM code review step is redundant verification-theater. The code either passes the gates or it doesn't. | Trust the verification pipeline. If a check is missing, add a new programmatic verifier, not an LLM reviewer. |
| Slack/webhook notifications | Users want notifications when Forge needs attention or finishes | Nice-to-have that adds external service dependencies, auth management, and failure modes to the core pipeline. | Defer to v2. In v1, forge status + the human checkpoint terminal output are sufficient. |

## Feature Dependencies

```
Requirements Gathering (forge init)
    └──produces──> REQUIREMENTS.md
                       └──consumed by──> Wave 1 Execution
                       └──consumed by──> Spec Compliance Loop
                       └──consumed by──> UAT

CLI Entry Point
    └──requires──> State Manager
    └──requires──> Config Loader

Step Runner (query() wrapper)
    └──requires──> Agent SDK Integration
    └──requires──> Cost Controller
    └──requires──> State Manager

Phase Runner
    └──requires──> Step Runner
    └──requires──> Programmatic Verifiers
    └──requires──> Plan Verification Gates

Pipeline Controller (Wave Model)
    └──requires──> Phase Runner
    └──requires──> Dependency Graph / Topological Sort
    └──requires──> Human Checkpoint System
    └──requires──> Mock Registry

Spec Compliance Loop
    └──requires──> Pipeline Controller (phases complete)
    └──requires──> Programmatic Verifiers
    └──requires──> Gap Closure Strategy

UAT
    └──requires──> Spec Compliance Loop (all reqs verified)
    └──requires──> Docker / Application Stack
    └──requires──> Application-type-specific test strategies

Notion Documentation
    └──enhances──> Pipeline Controller (background docs)
    └──requires──> MCP Server (Notion API)

Parallelism (Across Phases)
    └──requires──> Dependency Graph
    └──requires──> Git conflict handling
    └──enhances──> Pipeline Controller
```

### Dependency Notes

- **Phase Runner requires Step Runner:** Phase runner is the orchestration layer that calls step runner multiple times (context, plan, verify, execute, test, gap close, docs). Step runner must be solid before phase runner can work.
- **Pipeline Controller requires Phase Runner:** The wave model calls phase runner for each phase. If phases don't work, waves don't work.
- **Spec Compliance Loop requires completed phases:** You can't check requirement compliance until requirements have been implemented.
- **UAT requires Spec Compliance Loop:** UAT is the final gate after all requirements pass programmatic checks. Running UAT before compliance wastes budget on known-broken features.
- **Notion Documentation enhances Pipeline Controller:** Docs run in background (don't await). Pipeline can work without Notion. Notion is a nice-to-have that should not block core pipeline.
- **Parallelism enhances Pipeline Controller:** Sequential execution works first. Parallel is an optimization. Don't build parallelism before the sequential pipeline works.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate that Forge can autonomously build software.

- [ ] **CLI entry point** (forge init, run, status, resume) -- Users need a way to invoke Forge
- [ ] **Config and state management** -- Foundation everything else depends on
- [ ] **Step runner** wrapping query() with budget enforcement and verification -- The core primitive
- [ ] **Programmatic verifiers** (files, tests, typecheck, lint) -- Without verification, autonomy is reckless
- [ ] **Phase runner** (context -> plan -> verify plan -> execute -> test -> gap closure) -- The full phase lifecycle
- [ ] **Pipeline controller with wave model** (Wave 1 build, human checkpoint, Wave 2 integration) -- The key differentiator
- [ ] **Spec compliance loop** with convergence checking -- What makes Forge finish, not just run
- [ ] **Mock strategy** (interface/mock/real/factory pattern) -- Required for Wave 1 to build without credentials
- [ ] **State persistence** across interruptions -- Required for resume after human checkpoint
- [ ] **Cost tracking** per step/phase/wave with budget enforcement -- Required for responsible autonomy

### Add After Validation (v1.x)

Features to add once the core pipeline demonstrably works end-to-end on a real project.

- [ ] **Requirements gatherer** (forge init interactive mode) -- Initially, users can write REQUIREMENTS.md manually. The interactive gatherer is a UX improvement, not a technical requirement.
- [ ] **UAT as final gate** -- Add after the spec compliance loop works. UAT is the quality ceiling, not the floor.
- [ ] **Parallelism** (concurrent phases, subagents within phases) -- Sequential works first. Parallel is an optimization for speed.
- [ ] **Gap closure with root cause diagnosis** -- Initially, simple retry-with-error-context is sufficient. Diagnostic step is a refinement.
- [ ] **Requirement traceability matrix** (TEST_GUIDE.md) -- Useful for auditability but not required for the pipeline to function.
- [ ] **GitHub Flow** (branch protection, phase branching, atomic merges) -- Nice git hygiene but not required for autonomous building.

### Future Consideration (v2+)

Features to defer until Forge has proven it can reliably build real projects.

- [ ] **Notion documentation** -- Requires MCP server setup, Notion API auth, and page structure management. High complexity, low priority for v1.
- [ ] **Agent teams / multi-project** -- Per PROJECT.md, explicitly out of scope for v1.
- [ ] **Webhook/Slack notifications** -- External service dependency, defer.
- [ ] **Holdout evaluation** (StrongDM-style scenario testing separate from coding agent) -- Architecturally interesting but adds significant complexity. Forge's spec compliance loop serves a similar purpose.
- [ ] **Mobile app UAT** (React Native/Flutter emulators) -- Niche use case, complex setup.
- [ ] **Deployment automation** (push to prod) -- Intentionally excluded. Build artifacts, don't deploy them.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Step runner (query() wrapper) | HIGH | MEDIUM | P1 |
| Programmatic verifiers | HIGH | MEDIUM | P1 |
| Phase runner | HIGH | HIGH | P1 |
| Pipeline controller (wave model) | HIGH | HIGH | P1 |
| State persistence + resume | HIGH | MEDIUM | P1 |
| Cost/budget controls | HIGH | LOW | P1 |
| CLI entry point | HIGH | LOW | P1 |
| Mock strategy (interface/mock/real/factory) | HIGH | MEDIUM | P1 |
| Spec compliance loop | HIGH | MEDIUM | P1 |
| Retry cascade (3x different approach -> skip -> stop) | HIGH | MEDIUM | P1 |
| Human checkpoint (batched) | HIGH | MEDIUM | P1 |
| Requirements gatherer (interactive) | MEDIUM | HIGH | P2 |
| Plan verification gates | MEDIUM | MEDIUM | P2 |
| UAT (final gate) | MEDIUM | HIGH | P2 |
| Parallelism (across phases) | MEDIUM | HIGH | P2 |
| Root cause diagnosis | MEDIUM | MEDIUM | P2 |
| TEST_GUIDE.md traceability | MEDIUM | LOW | P2 |
| GitHub Flow (branch protection) | MEDIUM | LOW | P2 |
| Atomic commits with req IDs | MEDIUM | LOW | P2 |
| Notion documentation | LOW | HIGH | P3 |
| Subagent parallelism (within phase) | LOW | HIGH | P3 |
| Holdout evaluation | LOW | HIGH | P3 |
| Slack/webhook notifications | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch -- Forge cannot function without these
- P2: Should have, add after core pipeline works end-to-end
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Devin | Cursor Agent | Codex CLI/App | Claude Code + GSD | Attractor | Forge (Planned) |
|---------|-------|--------------|---------------|-------------------|-----------|-----------------|
| **Autonomous code generation** | Full (cloud IDE, sandboxed VM) | Cloud Agents on isolated VMs | Cloud sandbox + local CLI | Agent SDK query() | DOT graph pipeline with LLM nodes | query() per step, fresh context |
| **Requirements gathering** | Takes task description, no structured elicitation | Takes prompts, no formal requirements | Takes GitHub issues | No built-in requirements phase | Markdown NLSpecs written by humans | Interactive 25+ topic structured gathering (R1, R2 format) |
| **Verification method** | Self-test + human PR review | BugBot code review + self-test + video demo | Sandbox execution + approval modes | Agent self-report (GSD verify-work) | Goal gates + holdout scenarios | Programmatic code checks (fs.existsSync, test JSON parsing, exit codes) |
| **Spec compliance** | No formal spec compliance loop | No | No | GSD audit-milestone (agent-driven) | Convergence loop until graph termination | Code-driven compliance loop with convergence checking |
| **Test generation** | Generates tests alongside code | Generates tests, BugBot reviews | Generates tests in sandbox | GSD add-tests skill | Tests part of pipeline nodes | Enforced test pyramid (unit/integration/scenario) per phase |
| **State persistence** | Machine snapshots, session management | Cursor session state | Cloud sessions persist | No built-in persistence | Checkpoint snapshots in run directory | forge-state.json + file-based phase checkpoints |
| **Cost controls** | ACU-based billing ($2.25/ACU) | Token-based, session limits | Per-session budget | maxBudgetUsd per query() | Not specified (LLM token-based) | Per-step, per-phase, per-wave, total project budget with hard stops |
| **Parallel execution** | Multiple Devins in parallel | Subagents + Cloud Agents in parallel | Worktrees for parallel agents | Subagents (experimental Agent Teams) | Parallel fan-out/fan-in nodes in graph | 3 levels: verification, within-phase subagents, across-phase concurrent |
| **External service handling** | Requests credentials when needed | Expects credentials available | Sandbox isolation | No built-in mock strategy | "Digital Twin Universe" (behavioral API clones) | Mock/real/factory pattern with registry, systematic Wave 2 swap |
| **Human interaction model** | Always accessible via chat, can interrupt | Review + approve model | 3 approval levels (Suggest/AutoEdit/FullAuto) | Interactive by default | Human wait gates in graph (hexagon nodes) | ONE batched checkpoint, then resume. Minimal human involvement. |
| **Documentation** | Devin Wiki (auto-generated codebase docs) | None built-in | None built-in | None built-in | Specs are the documentation | 8 mandatory Notion pages + phase reports + TEST_GUIDE.md |
| **Scope** | Single tasks/PRs (occasionally multi-step) | Single features/PRs | Single tasks/PRs | Single phases/milestones | Full system generation from NLSpecs | Full system generation from requirements (code, tests, CI/CD, docs, deployment configs) |
| **Pricing model** | $20-500/mo + ACU usage | Cursor subscription + token usage | OpenAI subscription + token usage | Anthropic API token usage | Open source (bring your own LLM) | Open source / self-hosted (Agent SDK token costs) |
| **Target level** | Level 2-3 (human reviews PRs) | Level 2-3 (human reviews in editor) | Level 2-3 (human approves changes) | Level 2-3 (human drives session) | Level 4 (dark factory, no human review) | Level 4 (dark factory with programmatic verification) |

### Key Competitive Insights

1. **No competitor does structured requirements gathering.** Devin, Cursor, and Codex all take informal task descriptions. Kiro does EARS-notation specs but for individual features, not entire systems. Forge's deep requirements gathering is genuinely novel for the "build an entire system" use case.

2. **The wave model is unique.** No competitor batches human needs into a single checkpoint. Devin pauses per-service. Cursor expects upfront config. Codex sandboxes but doesn't batch. Forge's "build everything with mocks, batch all human needs, then integrate" workflow is the key innovation.

3. **Programmatic verification at Forge's level is rare.** StrongDM's Attractor uses holdout scenarios evaluated by LLM -- still LLM-based verification. Cursor Cloud Agents self-test and record video -- still agent-driven. Forge's approach (code parses test JSON, checks exit codes, verifies files exist) is more deterministic than any competitor except traditional CI/CD.

4. **Full-system scope is Attractor's territory.** Devin, Cursor, and Codex build features/PRs. Only Attractor and Forge aim to build entire production systems from specs. Forge's advantage over Attractor is the interactive requirements phase (Attractor requires humans to write NLSpecs manually) and the wave model (Attractor's graph doesn't separate mock/real phases).

5. **Attractor's graph-based orchestration vs Forge's code-based orchestration is a genuine architectural difference.** Attractor defines pipelines in DOT files interpreted by LLM. Forge defines pipelines in TypeScript code. Code is more debuggable, testable, and deterministic. DOT files are more declarative and easier to visualize. Forge's approach is better for reliability; Attractor's is better for configurability.

## Sources

- [Devin AI Guide 2026](https://aitoolsdevpro.com/ai-tools/devin-guide/) -- Devin features, pricing, capabilities (MEDIUM confidence - review/guide site)
- [Cognition | Devin 2.0](https://cognition.ai/blog/devin-2) -- Official Devin 2.0 features (HIGH confidence - official)
- [Cursor: Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents) -- Cursor Cloud Agents (HIGH confidence - official)
- [Cursor Cloud Agents](https://www.nxcode.io/resources/news/cursor-cloud-agents-virtual-machines-autonomous-coding-guide-2026) -- Cloud agent architecture (MEDIUM confidence)
- [Introducing Codex | OpenAI](https://openai.com/index/introducing-codex/) -- Codex features (HIGH confidence - official)
- [OpenAI Codex App: A Guide to Multi-Agent AI Coding](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents) -- Codex multi-agent (MEDIUM confidence)
- [GitHub - strongdm/attractor](https://github.com/strongdm/attractor) -- Attractor specs and architecture (HIGH confidence - official repo)
- [Attractor Spec](https://github.com/strongdm/attractor/blob/main/attractor-spec.md) -- DOT graph pipeline, goal gates, convergence (HIGH confidence - official)
- [The Dark Factory Pattern](https://hackernoon.com/the-dark-factory-pattern-moving-from-ai-assisted-to-fully-autonomous-coding) -- Level 4/5 definitions, holdout pattern (MEDIUM confidence)
- [How StrongDM's AI team build serious software without looking at the code](https://simonwillison.net/2026/Feb/7/software-factory/) -- Software factory practices (MEDIUM confidence)
- [The Software Factory: A Practitioner's Guide](https://dev.to/thewoolleyman/the-software-factory-a-practitioners-guide-to-specification-driven-development-for-enterprise-244c) -- Spec-driven development practices (MEDIUM confidence)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- Agent Teams feature (HIGH confidence - official docs)
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) -- Agent SDK capabilities (HIGH confidence - official)
- [Kiro: Agentic AI development](https://kiro.dev/) -- Spec-driven development, EARS notation (HIGH confidence - official)
- [Kiro Specs Documentation](https://kiro.dev/docs/specs/) -- Requirements gathering approach (HIGH confidence - official docs)

---
*Feature research for: Autonomous software development orchestrator (Dark Factory)*
*Researched: 2026-03-05*
