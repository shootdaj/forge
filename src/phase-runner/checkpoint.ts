/**
 * Checkpoint Detection and Writing
 *
 * Manages file-based checkpoints for phase runner resumability.
 * Each substep writes a checkpoint file on completion; on restart,
 * the phase runner checks for these files to skip completed substeps.
 *
 * Requirements: PHA-11, PHA-12
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { CheckpointState, PhaseSubstep } from "./types.js";
import {
  CONTEXT_FILE,
  PLAN_FILE,
  EXECUTION_MARKER,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
} from "./types.js";

/**
 * The ordered list of all substeps in the phase lifecycle.
 * Used for mapping checkpoint state to completed substeps.
 */
const SUBSTEP_ORDER: PhaseSubstep[] = [
  "context",
  "plan",
  "verify-plan",
  "execute",
  "verify-build",
  "gap-closure",
  "docs",
];

/**
 * Mapping from checkpoint state flag names to substep names.
 * verify-plan is implicit (part of planDone), so it is not separately tracked.
 */
const CHECKPOINT_TO_SUBSTEP: Array<{
  flag: keyof CheckpointState;
  substep: PhaseSubstep;
}> = [
  { flag: "contextDone", substep: "context" },
  { flag: "planDone", substep: "plan" },
  // verify-plan is implicit once planDone is true
  { flag: "executionDone", substep: "execute" },
  { flag: "verificationDone", substep: "verify-build" },
  { flag: "gapsDone", substep: "gap-closure" },
  { flag: "reportDone", substep: "docs" },
];

/**
 * Resolve the phase directory path for a given phase number.
 *
 * Returns the path `{baseDir}/.planning/phases/{NN}-phase-{N}/`
 * and creates the directory if it doesn't exist.
 *
 * @param phaseNumber - The phase number (e.g., 5)
 * @param baseDir - Project root directory (defaults to process.cwd())
 * @param fsImpl - Optional fs implementation for testing
 * @returns Absolute path to the phase directory
 */
export function resolvePhaseDir(
  phaseNumber: number,
  baseDir?: string,
  fsImpl?: { mkdirSync: typeof fs.mkdirSync },
): string {
  const root = baseDir ?? process.cwd();
  const paddedNumber = String(phaseNumber).padStart(2, "0");
  const phaseDir = path.join(
    root,
    ".planning",
    "phases",
    `${paddedNumber}-phase-${phaseNumber}`,
  );

  const fsOps = fsImpl ?? fs;
  fsOps.mkdirSync(phaseDir, { recursive: true });

  return phaseDir;
}

/**
 * Detect which checkpoint files exist in a phase directory.
 *
 * Checks for the existence of each checkpoint file and returns
 * a CheckpointState with boolean flags for each substep.
 *
 * @param phaseDir - Absolute path to the phase directory
 * @param fsImpl - Optional fs implementation for testing
 * @returns CheckpointState with boolean flags
 *
 * Requirements: PHA-11, PHA-12
 */
export function detectCheckpoints(
  phaseDir: string,
  fsImpl?: { existsSync: typeof fs.existsSync },
): CheckpointState {
  const fsOps = fsImpl ?? fs;

  return {
    contextDone: fsOps.existsSync(path.join(phaseDir, CONTEXT_FILE)),
    planDone: fsOps.existsSync(path.join(phaseDir, PLAN_FILE)),
    executionDone: fsOps.existsSync(path.join(phaseDir, EXECUTION_MARKER)),
    verificationDone: fsOps.existsSync(
      path.join(phaseDir, VERIFICATION_FILE),
    ),
    gapsDone: fsOps.existsSync(path.join(phaseDir, GAPS_FILE)),
    reportDone: fsOps.existsSync(path.join(phaseDir, REPORT_FILE)),
  };
}

/**
 * Write a checkpoint file to the phase directory.
 *
 * Ensures the directory exists before writing. The content is written
 * synchronously to guarantee the checkpoint is durable before continuing.
 *
 * @param phaseDir - Absolute path to the phase directory
 * @param fileName - Checkpoint file name (e.g., CONTEXT_FILE)
 * @param content - Content to write to the checkpoint file
 * @param fsImpl - Optional fs implementation for testing
 *
 * Requirement: PHA-11
 */
export function writeCheckpoint(
  phaseDir: string,
  fileName: string,
  content: string,
  fsImpl?: {
    mkdirSync: typeof fs.mkdirSync;
    writeFileSync: typeof fs.writeFileSync;
  },
): void {
  const fsOps = fsImpl ?? fs;

  // Ensure directory exists
  fsOps.mkdirSync(phaseDir, { recursive: true });

  // Write checkpoint file
  const filePath = path.join(phaseDir, fileName);
  fsOps.writeFileSync(filePath, content, "utf-8");
}

/**
 * Get the list of completed substeps based on checkpoint state.
 *
 * Returns substeps in lifecycle order. The "verify-plan" substep
 * is considered complete when planDone is true (plan verification
 * is part of the plan creation checkpoint).
 *
 * @param checkpoints - The current checkpoint state
 * @returns Ordered array of completed substep names
 *
 * Requirement: PHA-12
 */
export function getCompletedSubsteps(
  checkpoints: CheckpointState,
): PhaseSubstep[] {
  const completed: PhaseSubstep[] = [];

  for (const { flag, substep } of CHECKPOINT_TO_SUBSTEP) {
    if (checkpoints[flag]) {
      completed.push(substep);
      // verify-plan is implicitly done when planDone is true
      if (substep === "plan") {
        completed.push("verify-plan");
      }
    }
  }

  // Sort by lifecycle order
  return completed.sort(
    (a, b) => SUBSTEP_ORDER.indexOf(a) - SUBSTEP_ORDER.indexOf(b),
  );
}
