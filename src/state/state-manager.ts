/**
 * Forge State Manager
 *
 * Persists orchestrator state to forge-state.json with:
 * - Atomic write-rename pattern (no partial writes)
 * - In-process mutex for concurrent write safety
 * - snake_case JSON <-> camelCase TypeScript mapping
 * - Zod validation on load
 *
 * Requirements: STA-01, STA-02, STA-03, STA-04, STA-05
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ForgeStateSchema, type ForgeState, type ForgeStateRaw } from "./schema.js";
import {
  snakeToCamelKeys,
  camelToSnakeKeys,
} from "../utils/case-transform.js";

/**
 * Error thrown when state validation fails on load.
 */
export class StateValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{
      path: (string | number)[];
      message: string;
    }>,
  ) {
    super(message);
    this.name = "StateValidationError";
  }
}

/**
 * Error thrown when state file cannot be read.
 */
export class StateLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StateLoadError";
  }
}

/**
 * The default state file name.
 */
export const STATE_FILE_NAME = "forge-state.json";

/**
 * Simple promise-based mutex for concurrent write safety.
 *
 * This prevents multiple concurrent `update()` calls from
 * reading stale state and overwriting each other's changes.
 *
 * Requirement: STA-05
 */
class Mutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }
}

/**
 * Create an initial state object with all fields properly initialized.
 *
 * Requirement: STA-03
 *
 * @param projectDir - Absolute path to the project directory
 * @param model - Model to use (defaults to claude-opus-4-6)
 */
export function createInitialState(
  projectDir: string,
  model?: string,
): ForgeState {
  return {
    projectDir,
    startedAt: new Date().toISOString(),
    model: model ?? "claude-opus-4-6",
    requirementsDoc: "REQUIREMENTS.md",
    status: "initializing",
    currentWave: 1,
    projectInitialized: false,
    scaffolded: false,
    phases: {},
    servicesNeeded: [],
    mockRegistry: {},
    skippedItems: [],
    credentials: {},
    humanGuidance: {},
    specCompliance: {
      totalRequirements: 0,
      verified: 0,
      gapHistory: [],
      roundsCompleted: 0,
    },
    remainingGaps: [],
    uatResults: {
      status: "not_started",
      workflowsTested: 0,
      workflowsPassed: 0,
      workflowsFailed: 0,
    },
    deployment: {
      status: "not_started",
      url: "",
      target: "",
      attempts: 0,
    },
    totalBudgetUsed: 0,
  };
}

/**
 * Write data atomically to a file path.
 *
 * Uses the write-to-temp-then-rename pattern:
 * 1. Write content to a temp file in the same directory
 * 2. fsync the file descriptor to ensure data reaches disk
 * 3. Rename temp file to target (atomic on POSIX)
 *
 * This ensures that the target file is never in a partial state.
 * If the process crashes during write, only the temp file is affected.
 *
 * Requirements: STA-04, STA-05
 *
 * @param filePath - Target file path
 * @param content - Content to write
 */
export function atomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const tempPath = path.join(
    dir,
    `.${baseName}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );

  let fd: number | undefined;
  try {
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write to temp file
    fd = fs.openSync(tempPath, "w");
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    // Atomic rename
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up fd if still open
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors during error handling
      }
    }
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * StateManager manages forge-state.json with crash safety and concurrency.
 *
 * Requirements: STA-01, STA-02, STA-03, STA-04, STA-05
 */
export class StateManager {
  private readonly _statePath: string;
  private readonly _mutex = new Mutex();

  /**
   * @param projectDir - Directory where forge-state.json lives
   */
  constructor(projectDir: string) {
    this._statePath = path.join(projectDir, STATE_FILE_NAME);
  }

  /**
   * Get the path to the state file.
   */
  get statePath(): string {
    return this._statePath;
  }

  /**
   * Check if a state file exists.
   */
  exists(): boolean {
    return fs.existsSync(this._statePath);
  }

  /**
   * Load state from forge-state.json.
   *
   * - Reads the file
   * - Parses JSON
   * - Validates with Zod schema
   * - Maps snake_case to camelCase
   *
   * Throws StateLoadError if file doesn't exist or has invalid JSON.
   * Throws StateValidationError if schema validation fails.
   *
   * Requirements: STA-01, STA-02, STA-04
   */
  load(): ForgeState {
    if (!fs.existsSync(this._statePath)) {
      throw new StateLoadError(
        `State file not found: ${this._statePath}. Run 'forge init' first.`,
      );
    }

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(this._statePath, "utf-8");
    } catch (error) {
      throw new StateLoadError(
        `Cannot read state file: ${this._statePath}`,
        error,
      );
    }

    let rawJson: unknown;
    try {
      rawJson = JSON.parse(fileContent);
    } catch {
      throw new StateLoadError(
        `Invalid JSON in state file: ${this._statePath}`,
      );
    }

    const result = ForgeStateSchema.safeParse(rawJson);

    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      }));
      throw new StateValidationError(
        `State validation failed: ${issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        issues,
      );
    }

    return snakeToCamelKeys<ForgeState>(result.data);
  }

  /**
   * Save state to forge-state.json atomically.
   *
   * - Maps camelCase to snake_case
   * - Serializes to JSON with 2-space indentation
   * - Writes atomically via temp-file-rename pattern
   *
   * Requirements: STA-01, STA-02, STA-04
   */
  save(state: ForgeState): void {
    const rawState = camelToSnakeKeys<ForgeStateRaw>(state);
    const content = JSON.stringify(rawState, null, 2) + "\n";
    atomicWriteSync(this._statePath, content);
  }

  /**
   * Atomically update state with a mutex.
   *
   * 1. Acquires the mutex (blocks concurrent updates)
   * 2. Loads current state
   * 3. Applies the updater function
   * 4. Saves atomically
   * 5. Releases the mutex
   *
   * This is the primary API for state mutations.
   * The updater function receives the current state and must return the new state.
   *
   * Requirements: STA-04, STA-05
   *
   * @param updater - Function that transforms the current state
   * @returns The updated state
   */
  async update(
    updater: (current: ForgeState) => ForgeState,
  ): Promise<ForgeState> {
    await this._mutex.acquire();
    try {
      const current = this.load();
      const updated = updater(current);
      this.save(updated);
      return updated;
    } finally {
      this._mutex.release();
    }
  }

  /**
   * Initialize a new state file.
   *
   * Creates the initial state and saves it atomically.
   *
   * @param projectDir - Absolute path to the project
   * @param model - Model to use
   * @returns The created initial state
   */
  initialize(projectDir: string, model?: string): ForgeState {
    const state = createInitialState(projectDir, model);
    this.save(state);
    return state;
  }
}
