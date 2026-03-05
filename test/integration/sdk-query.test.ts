/**
 * Integration tests for SDK query wrapper.
 *
 * These tests verify that:
 * 1. executeQuery correctly wires options to the mock query function
 * 2. The full pipeline (options build -> message processing -> result extraction) works end-to-end
 * 3. Error scenarios propagate correctly through the full stack
 *
 * These do NOT make real SDK calls (that would burn tokens).
 * Real SDK calls are validated via the manual integration test (see sdk-live.test.ts comment).
 *
 * Test naming: Test<Component>_<Behavior>[_<Condition>]
 */

import { describe, it, expect, vi } from "vitest";
import {
  executeQuery,
  buildSDKOptions,
  processQueryMessages,
} from "../../src/sdk/query-wrapper.js";
import type { ForgeQueryOptions } from "../../src/sdk/types.js";

// ============================================================
// Helper: Create realistic message sequences
// ============================================================

function createRealisticSuccessSequence(overrides: {
  sessionId?: string;
  cost?: number;
  turns?: number;
  structuredOutput?: unknown;
  result?: string;
} = {}) {
  return [
    {
      type: "system" as const,
      subtype: "init" as const,
      uuid: "uuid-1",
      session_id: overrides.sessionId ?? "integration-session-1",
      tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch"],
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "bypassPermissions",
      slash_commands: ["/gsd:plan-phase", "/gsd:execute-phase", "/gsd:discuss-phase"],
      claude_code_version: "1.2.3",
      cwd: "/test/project",
      agents: [],
      apiKeySource: "environment",
      betas: [],
      mcp_servers: [],
      output_style: "concise",
      skills: ["gsd"],
      plugins: [],
    },
    {
      type: "assistant" as const,
      uuid: "uuid-2",
      session_id: overrides.sessionId ?? "integration-session-1",
      message: {
        id: "msg-1",
        content: [{ type: "text", text: "I'll analyze the project." }],
        model: "claude-sonnet-4-5-20250929",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 100 },
      },
      parent_tool_use_id: null,
    },
    {
      type: "assistant" as const,
      uuid: "uuid-3",
      session_id: overrides.sessionId ?? "integration-session-1",
      message: {
        id: "msg-2",
        content: [{ type: "text", text: "Analysis complete." }],
        model: "claude-sonnet-4-5-20250929",
        stop_reason: "end_turn",
        usage: { input_tokens: 300, output_tokens: 200 },
      },
      parent_tool_use_id: null,
    },
    {
      type: "result" as const,
      subtype: "success" as const,
      uuid: "uuid-4",
      session_id: overrides.sessionId ?? "integration-session-1",
      duration_ms: 8500,
      duration_api_ms: 7200,
      is_error: false,
      num_turns: overrides.turns ?? 3,
      result: overrides.result ?? "Analysis completed successfully.",
      stop_reason: "end_turn",
      total_cost_usd: overrides.cost ?? 0.0156,
      usage: {
        input_tokens: 2000,
        output_tokens: 500,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
      modelUsage: {
        "claude-sonnet-4-5-20250929": {
          inputTokens: 2000,
          outputTokens: 500,
          cacheCreationInputTokens: 100,
          cacheReadInputTokens: 50,
        },
      },
      permission_denials: [],
      ...(overrides.structuredOutput
        ? { structured_output: overrides.structuredOutput }
        : {}),
    },
  ];
}

function createRealisticErrorSequence(
  errorSubtype: string,
  errorMessages: string[],
) {
  return [
    {
      type: "system" as const,
      subtype: "init" as const,
      uuid: "uuid-1",
      session_id: "integration-error-session",
      tools: ["Read", "Write", "Bash"],
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "bypassPermissions",
      slash_commands: [],
      claude_code_version: "1.2.3",
      cwd: "/test/project",
      agents: [],
      apiKeySource: "environment",
      betas: [],
      mcp_servers: [],
      output_style: "concise",
      skills: [],
      plugins: [],
    },
    {
      type: "result" as const,
      subtype: errorSubtype,
      uuid: "uuid-2",
      session_id: "integration-error-session",
      duration_ms: 3000,
      duration_api_ms: 2500,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0.005,
      usage: {
        input_tokens: 300,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
      errors: errorMessages,
    },
  ];
}

// ============================================================
// Tests: Full pipeline integration
// ============================================================

describe("TestSDKIntegration_FullPipeline", () => {
  it("_SuccessfulQuery_EndToEnd", async () => {
    const messages = createRealisticSuccessSequence({
      cost: 0.0234,
      turns: 5,
    });

    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    const result = await executeQuery(
      {
        prompt: "Analyze the project structure",
        model: "claude-sonnet-4-5-20250929",
        maxBudgetUsd: 5.0,
        maxTurns: 50,
      },
      mockQueryFn,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("Analysis completed successfully.");
      expect(result.sessionId).toBe("integration-session-1");
      expect(result.cost.totalCostUsd).toBe(0.0234);
      expect(result.cost.numTurns).toBe(5);
      expect(result.cost.usage.inputTokens).toBeGreaterThan(0);
      expect(result.cost.usage.outputTokens).toBeGreaterThan(0);
      expect(result.cost.durationMs).toBeGreaterThan(0);
    }
  });

  it("_StructuredOutput_EndToEnd_SDK05", async () => {
    interface AnalysisResult {
      files: string[];
      summary: string;
      metrics: { lines: number; functions: number };
    }

    const expectedOutput: AnalysisResult = {
      files: ["src/index.ts", "src/utils.ts"],
      summary: "Found 2 TypeScript files",
      metrics: { lines: 150, functions: 8 },
    };

    const messages = createRealisticSuccessSequence({
      structuredOutput: expectedOutput,
    });

    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    const { z } = await import("zod");
    const schema = z.object({
      files: z.array(z.string()),
      summary: z.string(),
      metrics: z.object({
        lines: z.number(),
        functions: z.number(),
      }),
    });

    const result = await executeQuery<AnalysisResult>(
      {
        prompt: "Analyze the project",
        outputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
      },
      mockQueryFn,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.structuredOutput).toEqual(expectedOutput);
      expect(result.structuredOutput?.files).toHaveLength(2);
      expect(result.structuredOutput?.metrics.lines).toBe(150);
    }
  });

  it("_BudgetExceeded_EndToEnd_SDK04", async () => {
    const messages = createRealisticErrorSequence("error_max_budget_usd", [
      "Budget limit of $5.00 exceeded at $5.23",
    ]);

    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    const result = await executeQuery(
      { prompt: "Expensive operation", maxBudgetUsd: 5.0 },
      mockQueryFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("budget_exceeded");
      expect(result.error.mayHavePartialWork).toBe(true);
      expect(result.cost.totalCostUsd).toBeGreaterThan(0);
      expect(result.sessionId).toBe("integration-error-session");
    }
  });

  it("_MaxTurns_EndToEnd_SDK04", async () => {
    const messages = createRealisticErrorSequence("error_max_turns", [
      "Maximum turns (50) reached",
    ]);

    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    const result = await executeQuery(
      { prompt: "Complex task", maxTurns: 50 },
      mockQueryFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("max_turns");
      expect(result.error.mayHavePartialWork).toBe(true);
    }
  });
});

// ============================================================
// Tests: Options wiring verification
// ============================================================

describe("TestSDKIntegration_OptionsWiring", () => {
  it("_AllForgeOptionsMappedToSDK", async () => {
    let capturedOptions: Record<string, unknown> = {};

    const mockQueryFn = async function* (args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      capturedOptions = args.options ?? {};
      const messages = createRealisticSuccessSequence();
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    await executeQuery(
      {
        prompt: "Full options test",
        cwd: "/custom/project",
        model: "claude-opus-4-6",
        fallbackModel: "claude-sonnet-4-5-20250929",
        maxBudgetUsd: 15.0,
        maxTurns: 200,
        outputSchema: { type: "object", properties: { x: { type: "string" } } },
        disallowedTools: ["WebSearch"],
      },
      mockQueryFn,
    );

    // Verify all options were passed through
    expect(capturedOptions.permissionMode).toBe("bypassPermissions");
    expect(capturedOptions.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedOptions.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(capturedOptions.settingSources).toEqual(["user", "project", "local"]);
    expect(capturedOptions.cwd).toBe("/custom/project");
    expect(capturedOptions.model).toBe("claude-opus-4-6");
    expect(capturedOptions.fallbackModel).toBe("claude-sonnet-4-5-20250929");
    expect(capturedOptions.maxBudgetUsd).toBe(15.0);
    expect(capturedOptions.maxTurns).toBe(200);
    expect(capturedOptions.outputFormat).toEqual({
      type: "json_schema",
      schema: { type: "object", properties: { x: { type: "string" } } },
    });
    expect(capturedOptions.disallowedTools).toEqual(["WebSearch"]);
  });

  it("_MinimalOptionsHaveCorrectDefaults", async () => {
    let capturedOptions: Record<string, unknown> = {};

    const mockQueryFn = async function* (args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      capturedOptions = args.options ?? {};
      const messages = createRealisticSuccessSequence();
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    await executeQuery({ prompt: "Minimal test" }, mockQueryFn);

    // Core security and behavior options MUST be present
    expect(capturedOptions.permissionMode).toBe("bypassPermissions");
    expect(capturedOptions.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedOptions.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(capturedOptions.settingSources).toEqual(["user", "project", "local"]);
    expect(capturedOptions.model).toBe("claude-sonnet-4-5-20250929");

    // Optional fields should NOT be present
    expect(capturedOptions.maxBudgetUsd).toBeUndefined();
    expect(capturedOptions.maxTurns).toBeUndefined();
    expect(capturedOptions.outputFormat).toBeUndefined();
    expect(capturedOptions.disallowedTools).toBeUndefined();
    expect(capturedOptions.fallbackModel).toBeUndefined();
  });
});

// ============================================================
// Tests: Error propagation through full stack
// ============================================================

describe("TestSDKIntegration_ErrorPropagation", () => {
  it("_AuthError_PropagatesCategory", async () => {
    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      yield {
        type: "system",
        subtype: "init",
        uuid: "u1",
        session_id: "s1",
        tools: [],
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "bypassPermissions",
        slash_commands: [],
        claude_code_version: "1.0.0",
        cwd: "/test",
      } as { type: string; [key: string]: unknown };
      yield {
        type: "assistant",
        uuid: "u2",
        session_id: "s1",
        message: { id: "m1", content: [], usage: {} },
        parent_tool_use_id: null,
        error: "authentication_failed",
      } as { type: string; [key: string]: unknown };
    };

    const result = await executeQuery(
      { prompt: "Should fail auth" },
      mockQueryFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("auth");
      expect(result.error.mayHavePartialWork).toBe(false);
    }
  });

  it("_StructuredOutputRetryExceeded_PropagatesCategory", async () => {
    const messages = createRealisticErrorSequence(
      "error_max_structured_output_retries",
      ["Failed to produce valid JSON after 3 attempts"],
    );

    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      for (const msg of messages) {
        yield msg as { type: string; [key: string]: unknown };
      }
    };

    const result = await executeQuery(
      {
        prompt: "Structured output test",
        outputSchema: { type: "object", properties: {} },
      },
      mockQueryFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("structured_output_retry_exceeded");
      expect(result.error.rawErrors).toContain(
        "Failed to produce valid JSON after 3 attempts",
      );
    }
  });
});
