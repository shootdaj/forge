/**
 * Unit tests for the SDK query wrapper.
 *
 * These tests mock the SDK's async generator to test:
 * - Message processing and result extraction (SDK-01)
 * - System prompt and settings configuration (SDK-02, SDK-03)
 * - Permission mode configuration (SDK-04)
 * - Structured output extraction (SDK-05)
 * - Cost data extraction
 * - Error categorization
 *
 * Test naming: Test<Component>_<Behavior>[_<Condition>]
 */

import { describe, it, expect } from "vitest";
import {
  processQueryMessages,
  buildSDKOptions,
  extractCostData,
  extractInitData,
  categorizeResultSubtype,
  categorizeAssistantError,
  executeQuery,
} from "./query-wrapper.js";
import type {
  ForgeQueryOptions,
  QuerySuccess,
  QueryFailure,
  SDKErrorCategory,
} from "./types.js";

// ============================================================
// Helper: Create an async iterable from an array of messages
// ============================================================

async function* mockMessageStream(
  messages: Array<Record<string, unknown>>,
): AsyncGenerator<{ type: string; subtype?: string; [key: string]: unknown }> {
  for (const msg of messages) {
    yield msg as { type: string; subtype?: string; [key: string]: unknown };
  }
}

// ============================================================
// Helper: Standard message fixtures
// ============================================================

function makeSystemInitMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "init",
    uuid: "test-uuid-1",
    session_id: "test-session-123",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    model: "claude-sonnet-4-5-20250929",
    permissionMode: "bypassPermissions",
    slash_commands: ["/gsd:plan-phase", "/gsd:execute-phase"],
    claude_code_version: "1.0.0",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeSuccessResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    uuid: "test-uuid-2",
    session_id: "test-session-123",
    duration_ms: 15000,
    duration_api_ms: 12000,
    is_error: false,
    num_turns: 5,
    result: "Task completed successfully.",
    stop_reason: "end_turn",
    total_cost_usd: 0.0234,
    usage: {
      input_tokens: 1500,
      output_tokens: 800,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 100,
    },
    modelUsage: {
      "claude-sonnet-4-5-20250929": {
        inputTokens: 1500,
        outputTokens: 800,
        cacheCreationInputTokens: 200,
        cacheReadInputTokens: 100,
      },
    },
    permission_denials: [],
    ...overrides,
  };
}

function makeErrorResultMessage(
  subtype: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "result",
    subtype,
    uuid: "test-uuid-2",
    session_id: "test-session-123",
    duration_ms: 5000,
    duration_api_ms: 4000,
    is_error: true,
    num_turns: 3,
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    errors: ["An error occurred"],
    ...overrides,
  };
}

function makeAssistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    uuid: "test-uuid-3",
    session_id: "test-session-123",
    message: {
      id: "msg-123",
      content: [{ type: "text", text: "Working on it..." }],
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    parent_tool_use_id: null,
    ...overrides,
  };
}

// ============================================================
// Tests: categorizeResultSubtype (SDK-04)
// ============================================================

describe("TestCategorizeResultSubtype", () => {
  it("_BudgetExceeded", () => {
    expect(categorizeResultSubtype("error_max_budget_usd")).toBe(
      "budget_exceeded",
    );
  });

  it("_MaxTurns", () => {
    expect(categorizeResultSubtype("error_max_turns")).toBe("max_turns");
  });

  it("_ExecutionError", () => {
    expect(categorizeResultSubtype("error_during_execution")).toBe(
      "execution_error",
    );
  });

  it("_StructuredOutputRetry", () => {
    expect(
      categorizeResultSubtype("error_max_structured_output_retries"),
    ).toBe("structured_output_retry_exceeded");
  });

  it("_UnknownSubtype", () => {
    expect(categorizeResultSubtype("something_unexpected")).toBe("unknown");
  });
});

// ============================================================
// Tests: categorizeAssistantError (SDK-04)
// ============================================================

describe("TestCategorizeAssistantError", () => {
  it("_AuthenticationFailed", () => {
    expect(categorizeAssistantError("authentication_failed")).toBe("auth");
  });

  it("_BillingError", () => {
    expect(categorizeAssistantError("billing_error")).toBe("auth");
  });

  it("_RateLimit", () => {
    expect(categorizeAssistantError("rate_limit")).toBe("network");
  });

  it("_ServerError", () => {
    expect(categorizeAssistantError("server_error")).toBe("network");
  });

  it("_InvalidRequest", () => {
    expect(categorizeAssistantError("invalid_request")).toBe(
      "execution_error",
    );
  });

  it("_UnknownError", () => {
    expect(categorizeAssistantError("something_else")).toBe("unknown");
  });

  it("_Undefined", () => {
    expect(categorizeAssistantError(undefined)).toBe("unknown");
  });
});

// ============================================================
// Tests: extractCostData
// ============================================================

describe("TestExtractCostData", () => {
  it("_ExtractsAllFields", () => {
    const result = extractCostData({
      total_cost_usd: 0.0234,
      num_turns: 5,
      usage: {
        input_tokens: 1500,
        output_tokens: 800,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 100,
      },
      modelUsage: {
        "claude-sonnet-4-5-20250929": {
          inputTokens: 1500,
          outputTokens: 800,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 100,
        },
      },
      duration_ms: 15000,
      duration_api_ms: 12000,
    });

    expect(result.totalCostUsd).toBe(0.0234);
    expect(result.numTurns).toBe(5);
    expect(result.usage.inputTokens).toBe(1500);
    expect(result.usage.outputTokens).toBe(800);
    expect(result.usage.cacheCreationInputTokens).toBe(200);
    expect(result.usage.cacheReadInputTokens).toBe(100);
    expect(result.durationMs).toBe(15000);
    expect(result.durationApiMs).toBe(12000);
    expect(result.modelUsage["claude-sonnet-4-5-20250929"]).toBeDefined();
    expect(
      result.modelUsage["claude-sonnet-4-5-20250929"].inputTokens,
    ).toBe(1500);
  });

  it("_HandlesEmptyModelUsage", () => {
    const result = extractCostData({
      total_cost_usd: 0.01,
      num_turns: 1,
      usage: { input_tokens: 100, output_tokens: 50 },
      duration_ms: 1000,
      duration_api_ms: 800,
    });

    expect(result.modelUsage).toEqual({});
    expect(result.totalCostUsd).toBe(0.01);
  });
});

// ============================================================
// Tests: extractInitData
// ============================================================

describe("TestExtractInitData", () => {
  it("_ExtractsAllFields", () => {
    const initData = extractInitData({
      session_id: "test-123",
      tools: ["Read", "Write"],
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "bypassPermissions",
      slash_commands: ["/gsd:plan-phase"],
      claude_code_version: "1.0.0",
      cwd: "/test",
    });

    expect(initData.sessionId).toBe("test-123");
    expect(initData.tools).toEqual(["Read", "Write"]);
    expect(initData.model).toBe("claude-sonnet-4-5-20250929");
    expect(initData.permissionMode).toBe("bypassPermissions");
    expect(initData.slashCommands).toEqual(["/gsd:plan-phase"]);
    expect(initData.claudeCodeVersion).toBe("1.0.0");
    expect(initData.cwd).toBe("/test");
  });
});

// ============================================================
// Tests: buildSDKOptions (SDK-01, SDK-02, SDK-03, SDK-04)
// ============================================================

describe("TestBuildSDKOptions", () => {
  it("_DefaultConfiguration", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test prompt",
    };
    const sdkOpts = buildSDKOptions(opts);

    // SDK-04: Permission mode
    expect(sdkOpts.permissionMode).toBe("bypassPermissions");
    expect(sdkOpts.allowDangerouslySkipPermissions).toBe(true);

    // SDK-02: System prompt preset
    expect(sdkOpts.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });

    // SDK-03: Settings sources
    expect(sdkOpts.settingSources).toEqual(["user", "project", "local"]);

    // SDK-01: Default model
    expect(sdkOpts.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("_CustomModel", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      model: "claude-opus-4-6",
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.model).toBe("claude-opus-4-6");
  });

  it("_BudgetAndTurnLimits", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      maxBudgetUsd: 5.0,
      maxTurns: 50,
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.maxBudgetUsd).toBe(5.0);
    expect(sdkOpts.maxTurns).toBe(50);
  });

  it("_StructuredOutputSchema_SDK05", () => {
    const schema = {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["files", "summary"],
    };
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      outputSchema: schema,
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.outputFormat).toEqual({
      type: "json_schema",
      schema,
    });
  });

  it("_DisabledPresetAndSettings", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      useClaudeCodePreset: false,
      loadSettings: false,
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.systemPrompt).toBeUndefined();
    expect(sdkOpts.settingSources).toBeUndefined();
  });

  it("_DisallowedTools", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      disallowedTools: ["Bash", "Write"],
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.disallowedTools).toEqual(["Bash", "Write"]);
  });

  it("_CustomCwd", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      cwd: "/custom/path",
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.cwd).toBe("/custom/path");
  });

  it("_FallbackModel", () => {
    const opts: ForgeQueryOptions = {
      prompt: "Test",
      fallbackModel: "claude-sonnet-4-5-20250929",
    };
    const sdkOpts = buildSDKOptions(opts);
    expect(sdkOpts.fallbackModel).toBe("claude-sonnet-4-5-20250929");
  });
});

// ============================================================
// Tests: processQueryMessages (SDK-01, SDK-04, SDK-05)
// ============================================================

describe("TestProcessQueryMessages", () => {
  it("_SuccessfulQuery_SDK01", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeAssistantMessage(),
      makeSuccessResultMessage(),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("Task completed successfully.");
      expect(result.sessionId).toBe("test-session-123");
      expect(result.cost.totalCostUsd).toBe(0.0234);
      expect(result.cost.numTurns).toBe(5);
      expect(result.cost.durationMs).toBe(15000);
      expect(result.permissionDenials).toEqual([]);
    }
  });

  it("_StructuredOutput_SDK05", async () => {
    const structuredData = {
      files_created: ["src/index.ts", "src/utils.ts"],
      summary: "Created two files",
    };
    const messages = [
      makeSystemInitMessage(),
      makeSuccessResultMessage({ structured_output: structuredData }),
    ];
    const stream = mockMessageStream(messages);

    type OutputSchema = { files_created: string[]; summary: string };
    const result = await processQueryMessages<OutputSchema>(stream);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.structuredOutput).toEqual(structuredData);
      expect(result.structuredOutput?.files_created).toHaveLength(2);
      expect(result.structuredOutput?.summary).toBe("Created two files");
    }
  });

  it("_CostExtraction_SDK01", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeSuccessResultMessage({
        total_cost_usd: 0.1567,
        num_turns: 12,
        usage: {
          input_tokens: 5000,
          output_tokens: 3000,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 250,
        },
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cost.totalCostUsd).toBe(0.1567);
      expect(result.cost.numTurns).toBe(12);
      expect(result.cost.usage.inputTokens).toBe(5000);
      expect(result.cost.usage.outputTokens).toBe(3000);
    }
  });

  it("_BudgetExceededError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeErrorResultMessage("error_max_budget_usd", {
        errors: ["Budget limit of $5.00 exceeded"],
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("budget_exceeded");
      expect(result.error.mayHavePartialWork).toBe(true);
      expect(result.error.rawErrors).toContain(
        "Budget limit of $5.00 exceeded",
      );
      // Cost should still be tracked even on failure
      expect(result.cost.totalCostUsd).toBe(0.01);
    }
  });

  it("_MaxTurnsError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeErrorResultMessage("error_max_turns", {
        errors: ["Maximum turns reached"],
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("max_turns");
      expect(result.error.mayHavePartialWork).toBe(true);
    }
  });

  it("_ExecutionError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeErrorResultMessage("error_during_execution", {
        errors: ["Unexpected error in agent execution"],
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("execution_error");
      expect(result.error.mayHavePartialWork).toBe(true);
    }
  });

  it("_StructuredOutputRetryError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeErrorResultMessage("error_max_structured_output_retries", {
        errors: ["Could not produce valid JSON output after 3 retries"],
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("structured_output_retry_exceeded");
      expect(result.error.mayHavePartialWork).toBe(false);
    }
  });

  it("_AssistantAuthError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeAssistantMessage({ error: "authentication_failed" }),
      // No result message follows auth failure
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("auth");
      expect(result.error.mayHavePartialWork).toBe(false);
    }
  });

  it("_AssistantRateLimitError_SDK04", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeAssistantMessage({ error: "rate_limit" }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("network");
    }
  });

  it("_NoResultMessage", async () => {
    const messages = [makeSystemInitMessage(), makeAssistantMessage()];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("unknown");
      expect(result.error.message).toContain("No result message");
    }
  });

  it("_EmptyStream", async () => {
    const stream = mockMessageStream([]);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("unknown");
    }
  });

  it("_PermissionDenials", async () => {
    const messages = [
      makeSystemInitMessage(),
      makeSuccessResultMessage({
        permission_denials: [
          {
            tool_name: "Bash",
            tool_use_id: "tu-1",
            tool_input: { command: "rm -rf /" },
          },
        ],
      }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.permissionDenials).toHaveLength(1);
      expect(result.permissionDenials[0].toolName).toBe("Bash");
    }
  });

  it("_SessionIdFromInitMessage", async () => {
    const messages = [
      makeSystemInitMessage({ session_id: "init-session-456" }),
      makeSuccessResultMessage({ session_id: "result-session-456" }),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Result message session_id takes priority
      expect(result.sessionId).toBe("result-session-456");
    }
  });

  it("_AssistantErrorBeforeResult_IgnoredIfResultFollows", async () => {
    // If an assistant error occurs but a result message still follows,
    // the result takes priority
    const messages = [
      makeSystemInitMessage(),
      makeAssistantMessage({ error: "rate_limit" }),
      makeSuccessResultMessage(),
    ];
    const stream = mockMessageStream(messages);
    const result = await processQueryMessages(stream);

    // Result message present, so it should be processed as success
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// Tests: executeQuery with injected query function
// ============================================================

describe("TestExecuteQuery", () => {
  it("_WithMockQueryFn_SDK01", async () => {
    const mockQueryFn = async function* (args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      yield makeSystemInitMessage() as { type: string; [key: string]: unknown };
      yield makeSuccessResultMessage() as { type: string; [key: string]: unknown };
    };

    const result = await executeQuery(
      { prompt: "Hello, test!" },
      mockQueryFn,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe("Task completed successfully.");
      expect(result.cost.totalCostUsd).toBe(0.0234);
    }
  });

  it("_WithStructuredOutput_SDK05", async () => {
    const outputData = { analysis: "test", score: 42 };
    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      yield makeSystemInitMessage() as { type: string; [key: string]: unknown };
      yield makeSuccessResultMessage({
        structured_output: outputData,
      }) as { type: string; [key: string]: unknown };
    };

    type TestOutput = { analysis: string; score: number };
    const result = await executeQuery<TestOutput>(
      {
        prompt: "Analyze this",
        outputSchema: {
          type: "object",
          properties: {
            analysis: { type: "string" },
            score: { type: "number" },
          },
          required: ["analysis", "score"],
        },
      },
      mockQueryFn,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.structuredOutput?.analysis).toBe("test");
      expect(result.structuredOutput?.score).toBe(42);
    }
  });

  it("_PassesCorrectOptions_SDK02_SDK03_SDK04", async () => {
    let capturedOptions: Record<string, unknown> | undefined;

    const mockQueryFn = async function* (args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      capturedOptions = args.options;
      yield makeSystemInitMessage() as { type: string; [key: string]: unknown };
      yield makeSuccessResultMessage() as { type: string; [key: string]: unknown };
    };

    await executeQuery(
      {
        prompt: "Test prompt",
        model: "claude-opus-4-6",
        maxBudgetUsd: 10.0,
        maxTurns: 100,
      },
      mockQueryFn,
    );

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.permissionMode).toBe("bypassPermissions");
    expect(capturedOptions!.allowDangerouslySkipPermissions).toBe(true);
    expect(capturedOptions!.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
    });
    expect(capturedOptions!.settingSources).toEqual([
      "user",
      "project",
      "local",
    ]);
    expect(capturedOptions!.model).toBe("claude-opus-4-6");
    expect(capturedOptions!.maxBudgetUsd).toBe(10.0);
    expect(capturedOptions!.maxTurns).toBe(100);
  });

  it("_HandlesErrorResult", async () => {
    const mockQueryFn = async function* (_args: {
      prompt: string;
      options?: Record<string, unknown>;
    }) {
      yield makeSystemInitMessage() as { type: string; [key: string]: unknown };
      yield makeErrorResultMessage("error_max_budget_usd", {
        errors: ["Budget exceeded"],
      }) as { type: string; [key: string]: unknown };
    };

    const result = await executeQuery(
      { prompt: "Expensive task", maxBudgetUsd: 0.01 },
      mockQueryFn,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("budget_exceeded");
    }
  });
});

// ============================================================
// Tests: Zod schema to JSON schema conversion (SDK-05)
// ============================================================

describe("TestZodSchemaConversion_SDK05", () => {
  it("_ZodObjectToJSONSchema", async () => {
    // Use Zod 4 native toJSONSchema
    const { z } = await import("zod");
    const schema = z.object({
      files_created: z.array(z.string()),
      summary: z.string(),
      line_count: z.number().optional(),
    });

    // Zod 4 provides z.toJSONSchema()
    const jsonSchema = z.toJSONSchema(schema);

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
    expect((jsonSchema as { required?: string[] }).required).toContain("files_created");
    expect((jsonSchema as { required?: string[] }).required).toContain("summary");
  });

  it("_SchemaIntegratesWithBuildSDKOptions", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      result: z.string(),
      confidence: z.number(),
    });
    const jsonSchema = z.toJSONSchema(schema);

    const opts: ForgeQueryOptions = {
      prompt: "Test",
      outputSchema: jsonSchema as Record<string, unknown>,
    };
    const sdkOpts = buildSDKOptions(opts);

    expect(sdkOpts.outputFormat).toEqual({
      type: "json_schema",
      schema: jsonSchema,
    });
  });
});
