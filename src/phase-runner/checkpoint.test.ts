/**
 * Checkpoint Detection and Writing Tests
 *
 * Tests against the real filesystem using temp directories.
 * Validates checkpoint detection, writing, phase dir resolution,
 * and completed substep derivation.
 *
 * Requirements: PHA-11, PHA-12
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  detectCheckpoints,
  writeCheckpoint,
  resolvePhaseDir,
  getCompletedSubsteps,
} from "./checkpoint.js";
import type { CheckpointState } from "./types.js";
import {
  CONTEXT_FILE,
  PLAN_FILE,
  EXECUTION_MARKER,
  VERIFICATION_FILE,
  GAPS_FILE,
  REPORT_FILE,
} from "./types.js";

describe("Checkpoint", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-checkpoint-test-"));
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // detectCheckpoints
  // -----------------------------------------------------------------------

  it("TestCheckpoint_DetectAllCheckpoints", () => {
    // Create all checkpoint files
    fs.writeFileSync(path.join(tmpDir, CONTEXT_FILE), "context content");
    fs.writeFileSync(path.join(tmpDir, PLAN_FILE), "plan content");
    fs.writeFileSync(path.join(tmpDir, EXECUTION_MARKER), "");
    fs.writeFileSync(path.join(tmpDir, VERIFICATION_FILE), "verification");
    fs.writeFileSync(path.join(tmpDir, GAPS_FILE), "gaps content");
    fs.writeFileSync(path.join(tmpDir, REPORT_FILE), "report content");

    const state = detectCheckpoints(tmpDir);

    expect(state.contextDone).toBe(true);
    expect(state.planDone).toBe(true);
    expect(state.executionDone).toBe(true);
    expect(state.verificationDone).toBe(true);
    expect(state.gapsDone).toBe(true);
    expect(state.reportDone).toBe(true);
  });

  it("TestCheckpoint_DetectNoCheckpoints", () => {
    const state = detectCheckpoints(tmpDir);

    expect(state.contextDone).toBe(false);
    expect(state.planDone).toBe(false);
    expect(state.executionDone).toBe(false);
    expect(state.verificationDone).toBe(false);
    expect(state.gapsDone).toBe(false);
    expect(state.reportDone).toBe(false);
  });

  it("TestCheckpoint_DetectPartialCheckpoints", () => {
    // Only context and plan exist
    fs.writeFileSync(path.join(tmpDir, CONTEXT_FILE), "context");
    fs.writeFileSync(path.join(tmpDir, PLAN_FILE), "plan");

    const state = detectCheckpoints(tmpDir);

    expect(state.contextDone).toBe(true);
    expect(state.planDone).toBe(true);
    expect(state.executionDone).toBe(false);
    expect(state.verificationDone).toBe(false);
    expect(state.gapsDone).toBe(false);
    expect(state.reportDone).toBe(false);
  });

  // -----------------------------------------------------------------------
  // writeCheckpoint
  // -----------------------------------------------------------------------

  it("TestCheckpoint_WriteCreatesFile", () => {
    const content = "# Phase Context\n\nThis is the context content.";

    writeCheckpoint(tmpDir, CONTEXT_FILE, content);

    const filePath = path.join(tmpDir, CONTEXT_FILE);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
  });

  it("TestCheckpoint_WriteCreatesDirectory", () => {
    const nestedDir = path.join(tmpDir, "nested", "phase-dir");
    const content = "checkpoint content";

    writeCheckpoint(nestedDir, PLAN_FILE, content);

    const filePath = path.join(nestedDir, PLAN_FILE);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe(content);
  });

  // -----------------------------------------------------------------------
  // resolvePhaseDir
  // -----------------------------------------------------------------------

  it("TestCheckpoint_ResolvePhaseDir", () => {
    const phaseDir = resolvePhaseDir(5, tmpDir);

    const expected = path.join(tmpDir, ".planning", "phases", "05-phase-5");
    expect(phaseDir).toBe(expected);
    expect(fs.existsSync(phaseDir)).toBe(true);
  });

  it("TestCheckpoint_ResolvePhaseDir_PadsNumber", () => {
    const phaseDir = resolvePhaseDir(1, tmpDir);

    const expected = path.join(tmpDir, ".planning", "phases", "01-phase-1");
    expect(phaseDir).toBe(expected);
    expect(fs.existsSync(phaseDir)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // getCompletedSubsteps
  // -----------------------------------------------------------------------

  it("TestCheckpoint_GetCompletedSubsteps", () => {
    const checkpoints: CheckpointState = {
      contextDone: true,
      planDone: true,
      executionDone: true,
      verificationDone: false,
      gapsDone: false,
      reportDone: false,
    };

    const substeps = getCompletedSubsteps(checkpoints);

    expect(substeps).toEqual([
      "context",
      "plan",
      "verify-plan",
      "execute",
    ]);
  });

  it("TestCheckpoint_GetCompletedSubsteps_Empty", () => {
    const checkpoints: CheckpointState = {
      contextDone: false,
      planDone: false,
      executionDone: false,
      verificationDone: false,
      gapsDone: false,
      reportDone: false,
    };

    const substeps = getCompletedSubsteps(checkpoints);

    expect(substeps).toEqual([]);
  });

  it("TestCheckpoint_GetCompletedSubsteps_AllDone", () => {
    const checkpoints: CheckpointState = {
      contextDone: true,
      planDone: true,
      executionDone: true,
      verificationDone: true,
      gapsDone: true,
      reportDone: true,
    };

    const substeps = getCompletedSubsteps(checkpoints);

    expect(substeps).toEqual([
      "context",
      "plan",
      "verify-plan",
      "execute",
      "verify-build",
      "gap-closure",
      "docs",
    ]);
  });

  it("TestCheckpoint_GetCompletedSubsteps_NonContiguous", () => {
    // Unlikely in practice but tests ordering logic
    const checkpoints: CheckpointState = {
      contextDone: true,
      planDone: false,
      executionDone: false,
      verificationDone: true,
      gapsDone: false,
      reportDone: true,
    };

    const substeps = getCompletedSubsteps(checkpoints);

    // Should return only the done ones in lifecycle order
    expect(substeps).toEqual(["context", "verify-build", "docs"]);
  });

  // -----------------------------------------------------------------------
  // Integration: write then detect
  // -----------------------------------------------------------------------

  it("TestCheckpoint_WriteAndDetect_RoundTrip", () => {
    // Write some checkpoints
    writeCheckpoint(tmpDir, CONTEXT_FILE, "# Context\nDecisions here.");
    writeCheckpoint(tmpDir, PLAN_FILE, "# Plan\nTasks here.");
    writeCheckpoint(tmpDir, EXECUTION_MARKER, "");

    // Detect them
    const state = detectCheckpoints(tmpDir);

    expect(state.contextDone).toBe(true);
    expect(state.planDone).toBe(true);
    expect(state.executionDone).toBe(true);
    expect(state.verificationDone).toBe(false);
    expect(state.gapsDone).toBe(false);
    expect(state.reportDone).toBe(false);

    // Derive completed substeps
    const substeps = getCompletedSubsteps(state);
    expect(substeps).toEqual(["context", "plan", "verify-plan", "execute"]);
  });
});
