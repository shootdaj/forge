/**
 * SDK module - Forge's interface to the Claude Agent SDK
 *
 * This module provides the foundational primitive that all downstream
 * components depend on: a typed, cost-tracked, error-categorized wrapper
 * around the Agent SDK's query() function.
 */

export {
  executeQuery,
  processQueryMessages,
  buildSDKOptions,
  extractCostData,
  extractInitData,
  categorizeResultSubtype,
  categorizeAssistantError,
} from "./query-wrapper.js";

export type {
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
