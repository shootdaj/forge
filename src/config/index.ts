/**
 * Config module - Forge's project configuration
 *
 * Loads and validates forge.config.json with sensible defaults.
 * All config is snake_case in JSON, camelCase in TypeScript.
 * Global config at ~/.forge/config.json provides user-level defaults.
 *
 * Requirements: CFG-01, CFG-02, CFG-03
 */

export {
  loadConfig,
  loadConfigOrDefaults,
  getDefaultConfig,
  ConfigValidationError,
  CONFIG_FILE_NAME,
} from "./loader.js";

export { ForgeConfigSchema } from "./schema.js";

export type { ForgeConfig, ForgeConfigRaw } from "./schema.js";

export {
  loadGlobalConfig,
  saveGlobalConfig,
  updateGlobalConfig,
  getGlobalConfigDir,
  getGlobalConfigPath,
  GlobalConfigSchema,
} from "./global.js";

export type { GlobalConfigRaw } from "./global.js";
