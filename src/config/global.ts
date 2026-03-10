/**
 * Global Forge Config
 *
 * Manages ~/.forge/config.json — user-level settings that apply to all projects.
 * Project-level forge.config.json overrides these values.
 *
 * Requirements: CFG-01
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

/**
 * Schema for the notion section of global config.
 */
const GlobalNotionSchema = z.object({
  parent_page_id: z.string().default(""),
});

/**
 * Schema for ~/.forge/config.json
 * Uses z.any().default({}).pipe() pattern for nested defaults (Zod 4 compat).
 */
export const GlobalConfigSchema = z.object({
  notion: z.any().default({}).pipe(GlobalNotionSchema),
  model: z.string().default(""),
});

export type GlobalConfigRaw = z.infer<typeof GlobalConfigSchema>;

/**
 * Get the path to the global config directory.
 * @param baseDir - Override for testing (defaults to os.homedir())
 */
export function getGlobalConfigDir(baseDir?: string): string {
  return path.join(baseDir ?? os.homedir(), ".forge");
}

/**
 * Get the path to the global config file.
 * @param baseDir - Override for testing (defaults to os.homedir())
 */
export function getGlobalConfigPath(baseDir?: string): string {
  return path.join(getGlobalConfigDir(baseDir), "config.json");
}

/**
 * Load the global config from ~/.forge/config.json.
 * Returns defaults if the file doesn't exist.
 * @param baseDir - Override for testing (defaults to os.homedir())
 */
export function loadGlobalConfig(baseDir?: string): GlobalConfigRaw {
  const configPath = getGlobalConfigPath(baseDir);

  if (!fs.existsSync(configPath)) {
    return GlobalConfigSchema.parse({});
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const raw = JSON.parse(content);
    return GlobalConfigSchema.parse(raw);
  } catch {
    // If corrupt or invalid, return defaults
    return GlobalConfigSchema.parse({});
  }
}

/**
 * Save the global config to ~/.forge/config.json.
 * Creates ~/.forge/ directory if it doesn't exist.
 * @param config - Config to save
 * @param baseDir - Override for testing (defaults to os.homedir())
 */
export function saveGlobalConfig(config: GlobalConfigRaw, baseDir?: string): void {
  const dir = getGlobalConfigDir(baseDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getGlobalConfigPath(baseDir), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Update specific fields in the global config (merge, not replace).
 * @param updates - Partial config to merge
 * @param baseDir - Override for testing (defaults to os.homedir())
 */
export function updateGlobalConfig(
  updates: Partial<GlobalConfigRaw>,
  baseDir?: string,
): GlobalConfigRaw {
  const current = loadGlobalConfig(baseDir);
  const merged = {
    ...current,
    ...updates,
    notion: {
      ...current.notion,
      ...(updates.notion ?? {}),
    },
  };
  const validated = GlobalConfigSchema.parse(merged);
  saveGlobalConfig(validated, baseDir);
  return validated;
}
