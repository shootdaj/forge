/**
 * Forge SDK Query Wrapper
 *
 * Wraps the Agent SDK's query() function with Forge's configuration defaults,
 * typed result extraction, cost tracking, and error categorization.
 *
 * This is the foundational primitive that ALL downstream components depend on.
 *
 * Requirements: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ForgeQueryOptions,
  QueryResult,
  QuerySuccess,
  QueryFailure,
  CostData,
  SDKError,
  SDKErrorCategory,
  SDKInitData,
  TokenUsage,
  ModelUsageBreakdown,
} from "./types.js";

const LOG_DIR = path.join(process.cwd(), ".forge");
const LOG_FILE = path.join(LOG_DIR, "forge.log");

function log(level: string, msg: string, data?: unknown): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString();
    const line = data
      ? `[${ts}] [${level}] ${msg} ${JSON.stringify(data)}\n`
      : `[${ts}] [${level}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Logging should never crash the app
  }
}

/**
 * Default cost data for when a query produces no result message.
 */
function emptyCostData(): CostData {
  return {
    totalCostUsd: 0,
    numTurns: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    modelUsage: {},
    durationMs: 0,
    durationApiMs: 0,
  };
}

/**
 * Map an SDKResultMessage subtype to our error category.
 *
 * Requirement: SDK-04
 */
export function categorizeResultSubtype(subtype: string): SDKErrorCategory {
  switch (subtype) {
    case "error_max_turns":
      return "max_turns";
    case "error_max_budget_usd":
      return "budget_exceeded";
    case "error_during_execution":
      return "execution_error";
    case "error_max_structured_output_retries":
      return "structured_output_retry_exceeded";
    default:
      return "unknown";
  }
}

/**
 * Categorize an assistant-level error string into our error hierarchy.
 *
 * Requirement: SDK-04
 */
export function categorizeAssistantError(
  errorType: string | undefined,
): SDKErrorCategory {
  switch (errorType) {
    case "authentication_failed":
    case "billing_error":
      return "auth";
    case "rate_limit":
    case "server_error":
      return "network";
    case "invalid_request":
      return "execution_error";
    default:
      return "unknown";
  }
}

/**
 * Extract CostData from an SDK result message.
 *
 * Requirement: SDK-01 (cost tracking)
 */
export function extractCostData(resultMessage: {
  total_cost_usd: number;
  num_turns: number;
  usage: Record<string, number>;
  modelUsage?: Record<string, Record<string, number>>;
  duration_ms: number;
  duration_api_ms: number;
}): CostData {
  const usage: TokenUsage = {
    inputTokens: resultMessage.usage?.input_tokens ?? 0,
    outputTokens: resultMessage.usage?.output_tokens ?? 0,
    cacheCreationInputTokens:
      resultMessage.usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: resultMessage.usage?.cache_read_input_tokens ?? 0,
  };

  const modelUsage: ModelUsageBreakdown = {};
  if (resultMessage.modelUsage) {
    for (const [model, mu] of Object.entries(resultMessage.modelUsage)) {
      modelUsage[model] = {
        inputTokens: (mu as Record<string, number>).inputTokens ?? 0,
        outputTokens: (mu as Record<string, number>).outputTokens ?? 0,
        cacheCreationInputTokens:
          (mu as Record<string, number>).cacheCreationInputTokens ?? 0,
        cacheReadInputTokens:
          (mu as Record<string, number>).cacheReadInputTokens ?? 0,
      };
    }
  }

  return {
    totalCostUsd: resultMessage.total_cost_usd,
    numTurns: resultMessage.num_turns,
    usage,
    modelUsage,
    durationMs: resultMessage.duration_ms,
    durationApiMs: resultMessage.duration_api_ms,
  };
}

/**
 * Extract SDKInitData from a system init message.
 */
export function extractInitData(systemMessage: {
  session_id: string;
  tools: string[];
  model: string;
  permissionMode: string;
  slash_commands: string[];
  claude_code_version: string;
  cwd: string;
}): SDKInitData {
  return {
    sessionId: systemMessage.session_id,
    tools: systemMessage.tools,
    model: systemMessage.model,
    permissionMode: systemMessage.permissionMode,
    slashCommands: systemMessage.slash_commands,
    claudeCodeVersion: systemMessage.claude_code_version,
    cwd: systemMessage.cwd,
  };
}

/**
 * Build SDK options from ForgeQueryOptions.
 *
 * Requirements: SDK-01, SDK-02, SDK-03, SDK-04
 */
export function buildSDKOptions(opts: ForgeQueryOptions): Record<string, unknown> {
  const options: Record<string, unknown> = {
    // SDK-04: Autonomous execution mode
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,

    // SDK-01: Model configuration
    model: opts.model ?? "claude-sonnet-4-5-20250929",

    // Working directory
    cwd: opts.cwd ?? process.cwd(),
  };

  // SDK-02: System prompt preset for Claude Code behavior + GSD skills
  if (opts.useClaudeCodePreset !== false) {
    options.systemPrompt = { type: "preset", preset: "claude_code" };
  }

  // SDK-03: Load settings from filesystem for CLAUDE.md and GSD skills
  if (opts.loadSettings !== false) {
    options.settingSources = ["user", "project", "local"];
  }

  // Optional fallback model
  if (opts.fallbackModel) {
    options.fallbackModel = opts.fallbackModel;
  }

  // Budget control
  if (opts.maxBudgetUsd !== undefined) {
    options.maxBudgetUsd = opts.maxBudgetUsd;
  }

  // Turn limit
  if (opts.maxTurns !== undefined) {
    options.maxTurns = opts.maxTurns;
  }

  // SDK-05: Structured output via JSON schema
  if (opts.outputSchema) {
    options.outputFormat = {
      type: "json_schema",
      schema: opts.outputSchema,
    };
  }

  // Tool restrictions
  if (opts.disallowedTools?.length) {
    options.disallowedTools = opts.disallowedTools;
  }

  // Abort controller
  if (opts.abortController) {
    options.abortController = opts.abortController;
  }

  return options;
}

/**
 * Process the async generator from query() and extract results.
 *
 * This function iterates through all SDK messages, captures the init data,
 * watches for assistant errors, and extracts the final result.
 *
 * Requirements: SDK-01, SDK-04, SDK-05
 */
export async function processQueryMessages<T = unknown>(
  messageStream: AsyncIterable<{
    type: string;
    subtype?: string;
    session_id?: string;
    [key: string]: unknown;
  }>,
): Promise<QueryResult<T>> {
  let initData: SDKInitData | undefined;
  let lastAssistantError: string | undefined;

  // We'll capture the result message to extract everything from
  let resultMsg: Record<string, unknown> | undefined;

  // Use raw async iterator to avoid for-await cleanup semantics.
  // When `break` exits a for-await loop, it calls iterator.return() which
  // may block waiting for the SDK's child process to exit. By using the raw
  // protocol, we can abandon the iterator immediately after receiving the
  // result message without triggering cleanup.
  const iterator = messageStream[Symbol.asyncIterator]();
  const INACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes without a message = stuck
  while (true) {
    // Race iterator.next() against an inactivity timeout.
    // If the child process dies without emitting a result, this prevents
    // the pipeline from hanging forever.
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((resolve) =>
      setTimeout(() => resolve({ done: true, value: undefined }), INACTIVITY_TIMEOUT_MS),
    );
    const { value: message, done } = await Promise.race([
      iterator.next(),
      timeoutPromise,
    ]);
    if (done || !message) {
      if (!resultMsg) {
        log("WARN", "Iterator ended without result message (possible timeout or child process crash)");
      }
      break;
    }

    log("DEBUG", "SDK message", {
      type: message.type,
      subtype: message.subtype,
      keys: Object.keys(message),
    });

    // Print progress to terminal
    if (message.type === "assistant" && message.message) {
      const msg = message.message as { role?: string; content?: unknown };
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            const preview = (block.text as string).slice(0, 150);
            console.log(`[forge] ${preview}${(block.text as string).length > 150 ? "..." : ""}`);
          } else if (block.type === "tool_use") {
            console.log(`[forge] Tool: ${block.name}`);
          }
        }
      }
    } else if (message.type === "result") {
      console.log(`[forge] Query complete (subtype: ${message.subtype})`);
    }

    // Capture init data from system message
    if (message.type === "system" && message.subtype === "init") {
      initData = extractInitData(
        message as unknown as {
          session_id: string;
          tools: string[];
          model: string;
          permissionMode: string;
          slash_commands: string[];
          claude_code_version: string;
          cwd: string;
        },
      );
    }

    // Watch for assistant-level errors (auth failures, rate limits)
    if (message.type === "assistant" && message.error) {
      lastAssistantError = message.error as string;
    }

    // Capture the result message and stop iterating.
    // We abandon the iterator without calling return() so the pipeline
    // continues immediately even if the child process hasn't exited yet.
    if (message.type === "result") {
      resultMsg = message as unknown as Record<string, unknown>;
      break;
    }
  }

  const sessionId = initData?.sessionId ?? (resultMsg?.session_id as string | undefined);

  // If we got an assistant error before any result, treat it as a failure
  if (lastAssistantError && !resultMsg) {
    const category = categorizeAssistantError(lastAssistantError);
    return {
      ok: false,
      error: {
        category,
        message: `Assistant error: ${lastAssistantError}`,
        mayHavePartialWork: false,
      },
      sessionId,
      cost: emptyCostData(),
    } satisfies QueryFailure;
  }

  // No result message at all -- unexpected
  if (!resultMsg) {
    return {
      ok: false,
      error: {
        category: "unknown",
        message: "No result message received from SDK query",
        mayHavePartialWork: false,
      },
      sessionId,
      cost: emptyCostData(),
    } satisfies QueryFailure;
  }

  // Extract cost data from result message
  const costData = extractCostData(
    resultMsg as unknown as {
      total_cost_usd: number;
      num_turns: number;
      usage: Record<string, number>;
      modelUsage?: Record<string, Record<string, number>>;
      duration_ms: number;
      duration_api_ms: number;
    },
  );

  // Check for success
  if (resultMsg.subtype === "success") {
    const permissionDenials = (
      (resultMsg.permission_denials as Array<Record<string, unknown>>) ?? []
    ).map((pd) => ({
      toolName: pd.tool_name as string,
      toolUseId: pd.tool_use_id as string,
      toolInput: pd.tool_input as Record<string, unknown>,
    }));

    return {
      ok: true,
      result: resultMsg.result as string,
      structuredOutput: resultMsg.structured_output as T | undefined,
      sessionId: (resultMsg.session_id as string) ?? sessionId ?? "",
      cost: costData,
      permissionDenials,
    } satisfies QuerySuccess<T>;
  }

  // Error result -- categorize it
  const subtype = resultMsg.subtype as string;
  const category = categorizeResultSubtype(subtype);
  const errors = (resultMsg.errors as string[]) ?? [];
  const mayHavePartialWork =
    category === "budget_exceeded" ||
    category === "max_turns" ||
    category === "execution_error";

  return {
    ok: false,
    error: {
      category,
      message: errors.join("; ") || `Query failed with subtype: ${subtype}`,
      rawErrors: errors.length > 0 ? errors : undefined,
      mayHavePartialWork,
    },
    sessionId: (resultMsg.session_id as string) ?? sessionId,
    cost: costData,
  } satisfies QueryFailure;
}

/**
 * Execute a Forge query against the Agent SDK.
 *
 * This is the main entry point for all SDK interactions.
 * It configures the SDK with Forge's defaults, runs the query,
 * processes messages, and returns a typed result.
 *
 * Requirements: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05
 *
 * @param opts - Query configuration
 * @param queryFn - The SDK query function (injectable for testing)
 */
export async function executeQuery<T = unknown>(
  opts: ForgeQueryOptions,
  queryFn?: (args: {
    prompt: string;
    options?: Record<string, unknown>;
  }) => AsyncIterable<{ type: string; subtype?: string; [key: string]: unknown }>,
): Promise<QueryResult<T>> {
  const sdkOptions = buildSDKOptions(opts);
  log("INFO", "executeQuery called", {
    prompt: opts.prompt.slice(0, 200),
    model: opts.model,
    maxBudgetUsd: opts.maxBudgetUsd,
    maxTurns: opts.maxTurns,
    hasOutputSchema: !!opts.outputSchema,
  });
  log("DEBUG", "SDK options", sdkOptions);

  // Use injected queryFn or dynamically import the real SDK
  let messageStream: AsyncIterable<{
    type: string;
    subtype?: string;
    [key: string]: unknown;
  }>;

  if (queryFn) {
    messageStream = queryFn({ prompt: opts.prompt, options: sdkOptions });
  } else {
    // Dynamic import to avoid hard dependency in tests
    log("INFO", "Importing Agent SDK and calling query()...");
    console.log("[forge] Starting SDK query...");
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    messageStream = sdk.query({
      prompt: opts.prompt,
      options: {
        ...sdkOptions,
        stderr: (s: string) => {
          log("STDERR", s.trim());
        },
      } as Parameters<typeof sdk.query>[0]["options"],
    });
    log("INFO", "query() returned message stream");
  }

  try {
    const result = await processQueryMessages<T>(messageStream);
    log("INFO", "executeQuery result", {
      ok: result.ok,
      sessionId: result.sessionId,
      cost: result.cost,
      ...(result.ok ? {} : { error: (result as QueryFailure).error }),
    });
    return result;
  } catch (err) {
    log("ERROR", "executeQuery threw", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}
