# SDK Divergences: SPEC.md vs Actual Agent SDK

**Phase:** 1 - SDK Proof of Concept
**Verified against:** @anthropic-ai/claude-agent-sdk ^0.2.69
**Date:** 2026-03-05
**SDK Reference:** https://platform.claude.com/docs/en/api/agent-sdk/typescript

## Divergence Table

| # | SPEC.md Assumption | Actual SDK Behavior | Impact on Implementation |
|---|---|---|---|
| D1 | `systemPrompt: "claude_code"` (string) | `systemPrompt: { type: "preset", preset: "claude_code", append?: string }` (object) | Must use object form; string form sets a custom system prompt (losing Claude Code's built-in tools and behavior) |
| D2 | Settings loaded by default (CLAUDE.md, GSD skills available) | `settingSources` defaults to `[]` -- no settings loaded unless explicitly configured | Must set `settingSources: ["user", "project", "local"]` on every query() call to get CLAUDE.md and GSD skills |
| D3 | `permissionMode: "bypassPermissions"` sufficient for autonomous operation | Must also set `allowDangerouslySkipPermissions: true` alongside `permissionMode: "bypassPermissions"` | Without the safety flag, bypass mode silently fails and operations requiring permissions are denied |
| D4 | Cost tracked via callbacks or per-message accumulation | Cost available as `total_cost_usd` on `SDKResultMessage` (final message only) | Cost is known only after query completes; no mid-query cost tracking. Per-step budget uses SDK's `maxBudgetUsd` option |
| D5 | Structured output via direct schema on options | `outputFormat: { type: "json_schema", schema: JSONSchema }` -- nested object, not flat | Schema must be a JSON Schema object (not Zod directly); use `z.toJSONSchema()` (Zod 4) or `zodToJsonSchema()` (Zod 3) to convert |
| D6 | `SDKResultMessage.result` always present | On error subtypes, `result` field is absent; `errors: string[]` is present instead | Must check `subtype` before accessing `result` (success) vs `errors` (failure) |
| D7 | Subagent `tools` restricts available tools | `tools` on AgentDefinition lists allowed tools but does NOT restrict in `bypassPermissions` mode; use `disallowedTools` to actually block | For security-sensitive subagents, must use `disallowedTools` array to deny specific tools |
| D8 | Simple message types: system, assistant, result | SDK has 18+ message types including `stream_event`, `system` (init/compact_boundary), `assistant`, `user`, `result`, plus status, hook, task, rate_limit, and prompt_suggestion messages | Message processing loop must handle or ignore many more message types than spec assumed |
| D9 | Session management via simple session_id | SDK supports `sessionId` (set custom), `resume` (resume previous), `forkSession` (fork from previous), `persistSession` (disable saving) | More complex session lifecycle; Forge should use `sessionId` for tracking and `resume` only for crash recovery within a single step |
| D10 | No mention of `effort` parameter | SDK supports `effort: 'low' | 'medium' | 'high' | 'max'` controlling reasoning depth (default: 'high') | Can be used to reduce cost on simple tasks (low effort for verification queries) or increase quality on critical tasks (max) |
| D11 | Cost data only has `total_cost_usd` | Result message includes `total_cost_usd`, `usage` (aggregate tokens), `modelUsage` (per-model breakdown), `duration_ms`, `duration_api_ms` | Much richer cost/performance data available; Forge should capture all for visibility |
| D12 | `maxBudgetUsd` is a hard stop | SDK docs note maxBudgetUsd is "a target rather than a strict limit" for extended thinking | Forge's pre-step budget check should include a safety margin (e.g., check `remaining - perStepBudget > 0` rather than `remaining > 0`) |
| D13 | SPEC assumes agents field uses `allowedTools` | `AgentDefinition` uses `tools` (not `allowedTools`) for tool list, plus separate `disallowedTools` | Different field name for subagent tool configuration |
| D14 | No mention of thinking configuration | SDK supports `thinking: { type: 'adaptive' | 'enabled' | 'disabled', budgetTokens?: number }` | Can control extended thinking behavior; default is adaptive for supported models |
| D15 | No mention of plugins system | SDK supports `plugins: SdkPluginConfig[]` for loading local plugins | Future extensibility -- not needed for Phase 1 but available |
| D16 | Query returns only messages | `Query` object extends `AsyncGenerator` but also has methods: `interrupt()`, `rewindFiles()`, `setPermissionMode()`, `setModel()`, `initializationResult()`, `supportedCommands()`, `close()`, and more | Query object is richer than a simple async generator; useful for dynamic configuration changes |
| D17 | Zod schemas passed directly to SDK | SDK accepts JSON Schema format in `outputFormat.schema`; Zod schemas must be converted first | Use `z.toJSONSchema()` (Zod 4) or `zodToJsonSchema()` (zod-to-json-schema package for Zod 3) |
| D18 | `SDKAssistantMessage.error` is a generic error | Error is typed as `SDKAssistantMessageError`: `'authentication_failed' | 'billing_error' | 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown'` | Specific error strings enable precise categorization in Forge's error hierarchy |

## Key Implementation Decisions Based on Divergences

1. **Always use `buildSDKOptions()`** -- Never construct SDK options manually. The wrapper ensures D1, D2, D3 are always handled correctly.

2. **Error handling must check both assistant messages AND result messages** -- Auth errors appear on assistant messages (D18); budget/turn errors appear on result messages (D6).

3. **Cost tracking uses result message only** -- No mid-query cost tracking possible (D4). The pre-step budget check uses `maxBudgetUsd` on the SDK side and a Forge-side accumulator check before each step.

4. **Structured output requires JSON Schema conversion** -- Zod schemas must be converted via `z.toJSONSchema()` before passing to the SDK (D5, D17).

5. **Message processing must be resilient** -- The stream contains many message types beyond what the spec assumed (D8). The `processQueryMessages()` function only acts on `system.init`, `assistant` (for errors), and `result` messages, ignoring all others safely.

---

*Divergences documented: 2026-03-05*
*Verified against: @anthropic-ai/claude-agent-sdk ^0.2.69*
