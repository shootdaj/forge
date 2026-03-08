/**
 * Case Transform Utilities
 *
 * Generic bidirectional snake_case <-> camelCase mapping for JSON serialization.
 * Used by both config and state modules.
 *
 * Requirements: STA-02, CFG-02
 */

/**
 * Convert a snake_case string to camelCase.
 *
 * Examples:
 *   "max_budget_total" -> "maxBudgetTotal"
 *   "model" -> "model" (no change needed)
 *   "docker_compose_file" -> "dockerComposeFile"
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Convert a camelCase string to snake_case.
 *
 * Examples:
 *   "maxBudgetTotal" -> "max_budget_total"
 *   "model" -> "model" (no change needed)
 *   "dockerComposeFile" -> "docker_compose_file"
 */
export function camelToSnake(str: string): string {
  // Preserve keys that are already SCREAMING_SNAKE_CASE or numeric (e.g. env vars, phase IDs)
  if (/^[A-Z0-9_]+$/.test(str) || /^\d+$/.test(str)) {
    return str;
  }
  return str.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/**
 * Recursively transform all keys in an object from snake_case to camelCase.
 *
 * Handles nested objects, arrays, and primitive values.
 * Record/map keys (e.g., phase IDs like "1", "2") are preserved as-is.
 */
export function snakeToCamelKeys<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => snakeToCamelKeys(item)) as T;
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = snakeToCamelKeys(value);
    }
    return result as T;
  }

  return obj as T;
}

/**
 * Recursively transform all keys in an object from camelCase to snake_case.
 *
 * Handles nested objects, arrays, and primitive values.
 * Record/map keys (e.g., phase IDs like "1", "2") are preserved as-is.
 */
export function camelToSnakeKeys<T>(obj: unknown): T {
  if (obj === null || obj === undefined) {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => camelToSnakeKeys(item)) as T;
  }

  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = camelToSnakeKeys(value);
    }
    return result as T;
  }

  return obj as T;
}
