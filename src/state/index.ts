/**
 * State module - Forge's crash-safe state persistence
 *
 * Manages forge-state.json with atomic writes, mutex for concurrency,
 * and snake_case/camelCase serialization.
 *
 * Requirements: STA-01, STA-02, STA-03, STA-04, STA-05
 */

export {
  StateManager,
  StateValidationError,
  StateLoadError,
  STATE_FILE_NAME,
  createInitialState,
  atomicWriteSync,
} from "./state-manager.js";

export { ForgeStateSchema } from "./schema.js";

export type {
  ForgeState,
  ForgeStateRaw,
  PhaseStatus,
  OrchestratorStatus,
} from "./schema.js";
