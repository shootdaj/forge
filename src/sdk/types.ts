/**
 * Forge SDK Types
 *
 * Type definitions for the SDK proof-of-concept layer.
 * These types define the interface between Forge's deterministic orchestration
 * and the stochastic Agent SDK.
 *
 * Requirements: SDK-01, SDK-02, SDK-03, SDK-04, SDK-05
 */

/**
 * Error categories for SDK failures.
 * Downstream components (step runner, phase runner) switch on these to decide
 * whether to retry, skip, or halt.
 *
 * Requirement: SDK-04
 */
export type SDKErrorCategory =
  | "network" // Transient network failure -- may retry
  | "auth" // Authentication failed -- do not retry
  | "budget_exceeded" // maxBudgetUsd reached -- partial work may exist
  | "max_turns" // maxTurns reached -- partial work may exist
  | "execution_error" // Error during agent execution -- may retry with different approach
  | "structured_output_retry_exceeded" // Agent couldn't produce valid JSON output
  | "unknown"; // Unrecognized error -- log and surface

/**
 * Typed SDK error with category for downstream switching.
 *
 * Requirement: SDK-04
 */
export interface SDKError {
  category: SDKErrorCategory;
  message: string;
  /** Raw error strings from the SDK result message, if available */
  rawErrors?: string[];
  /** Whether partial work may have been done before the error */
  mayHavePartialWork: boolean;
}

/**
 * Token usage breakdown from a query.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/**
 * Per-model usage breakdown.
 */
export interface ModelUsageBreakdown {
  [modelName: string]: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

/**
 * Cost data extracted from a query result.
 *
 * Requirement: SDK-01 (cost tracking from total_cost_usd)
 */
export interface CostData {
  /** Total cost in USD for this query */
  totalCostUsd: number;
  /** Number of agent turns used */
  numTurns: number;
  /** Aggregate token usage */
  usage: TokenUsage;
  /** Per-model token breakdown */
  modelUsage: ModelUsageBreakdown;
  /** Duration of the query in milliseconds */
  durationMs: number;
  /** Duration of API calls specifically */
  durationApiMs: number;
}

/**
 * Successful query result with optional structured output.
 *
 * Requirements: SDK-01, SDK-05
 */
export interface QuerySuccess<T = unknown> {
  ok: true;
  /** Text result from the agent */
  result: string;
  /** Parsed structured output if outputFormat was used */
  structuredOutput: T | undefined;
  /** Session ID for debugging/logging */
  sessionId: string;
  /** Cost and usage data */
  cost: CostData;
  /** Permission denials encountered (if any) */
  permissionDenials: Array<{
    toolName: string;
    toolUseId: string;
    toolInput: Record<string, unknown>;
  }>;
}

/**
 * Failed query result with categorized error.
 *
 * Requirement: SDK-04
 */
export interface QueryFailure {
  ok: false;
  /** Categorized error for downstream switching */
  error: SDKError;
  /** Session ID (may still be available even on failure) */
  sessionId: string | undefined;
  /** Cost data (money was still spent even on failure) */
  cost: CostData;
}

/**
 * Discriminated union of query outcomes.
 * Downstream code uses: if (result.ok) { ... } else { switch(result.error.category) { ... } }
 */
export type QueryResult<T = unknown> = QuerySuccess<T> | QueryFailure;

/**
 * Configuration for a Forge SDK query.
 *
 * Requirements: SDK-01, SDK-02, SDK-03, SDK-04
 */
export interface ForgeQueryOptions {
  /** The prompt to send to the agent */
  prompt: string;
  /** Working directory for the agent */
  cwd?: string;
  /** Model to use (defaults to claude-sonnet-4-5-20250929 for POC) */
  model?: string;
  /** Fallback model if primary fails */
  fallbackModel?: string;
  /** Maximum budget in USD for this query */
  maxBudgetUsd?: number;
  /** Maximum conversation turns */
  maxTurns?: number;
  /**
   * JSON schema for structured output extraction.
   * When provided, the agent must return JSON matching this schema.
   *
   * Requirement: SDK-05
   */
  outputSchema?: Record<string, unknown>;
  /** Whether to use Claude Code system prompt preset (default: true) */
  useClaudeCodePreset?: boolean;
  /** Whether to load settings from filesystem (default: true) */
  loadSettings?: boolean;
  /** Tools to explicitly disallow */
  disallowedTools?: string[];
  /** AbortController for cancellation */
  abortController?: AbortController;
}

/**
 * SDK init event data captured from the system message.
 */
export interface SDKInitData {
  sessionId: string;
  tools: string[];
  model: string;
  permissionMode: string;
  slashCommands: string[];
  claudeCodeVersion: string;
  cwd: string;
}
