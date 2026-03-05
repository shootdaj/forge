/**
 * Forge Config Loader
 *
 * Loads and validates forge.config.json from the project root.
 * Returns a typed ForgeConfig object with camelCase properties.
 *
 * Requirements: CFG-01, CFG-02, CFG-03
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ForgeConfigSchema, type ForgeConfig, type ForgeConfigRaw } from "./schema.js";
import { snakeToCamelKeys } from "../utils/case-transform.js";

/**
 * Error thrown when config validation fails.
 * Includes field-level detail about what went wrong.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{
      path: (string | number)[];
      message: string;
    }>,
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * The default config file name.
 */
export const CONFIG_FILE_NAME = "forge.config.json";

/**
 * Load and validate forge.config.json from the given directory.
 *
 * Behavior:
 * - If the file doesn't exist, returns all defaults (empty config is valid)
 * - If the file exists but is invalid JSON, throws ConfigValidationError
 * - If the file exists but fails schema validation, throws ConfigValidationError with field details
 * - Returns a camelCase-typed ForgeConfig object
 *
 * Requirements: CFG-01 (loading), CFG-02 (validation + defaults), CFG-03 (all options)
 *
 * @param projectDir - The directory containing forge.config.json
 * @returns Validated and typed ForgeConfig
 */
export function loadConfig(projectDir: string): ForgeConfig {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);

  let rawJson: unknown;

  if (!fs.existsSync(configPath)) {
    // No config file — use all defaults
    rawJson = {};
  } else {
    const fileContent = fs.readFileSync(configPath, "utf-8");
    try {
      rawJson = JSON.parse(fileContent);
    } catch {
      throw new ConfigValidationError(
        `Invalid JSON in ${configPath}`,
        [{ path: [], message: "File contains invalid JSON" }],
      );
    }
  }

  const result = ForgeConfigSchema.safeParse(rawJson);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      message: issue.message,
    }));
    throw new ConfigValidationError(
      `Config validation failed: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      issues,
    );
  }

  // Validated raw config (snake_case)
  const rawConfig: ForgeConfigRaw = result.data;

  // Map to camelCase TypeScript interface
  return snakeToCamelKeys<ForgeConfig>(rawConfig);
}

/**
 * Load config with a fallback: if loading fails, return defaults.
 * Useful during initialization when the config file may not exist yet.
 */
export function loadConfigOrDefaults(projectDir: string): ForgeConfig {
  try {
    return loadConfig(projectDir);
  } catch {
    return loadConfig("/dev/null/nonexistent");
  }
}

/**
 * Get the default config with all defaults applied.
 * Useful for testing and initialization.
 */
export function getDefaultConfig(): ForgeConfig {
  const raw = ForgeConfigSchema.parse({});
  return snakeToCamelKeys<ForgeConfig>(raw);
}
