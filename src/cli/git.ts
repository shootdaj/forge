/**
 * Git Workflow Utilities
 *
 * Provides phase branching, atomic commits with requirement IDs,
 * merge-after-verify, and utility functions for git operations.
 *
 * All functions shell out to git via child_process.execSync.
 * All accept optional `cwd` and injectable `execFn` for testing.
 *
 * Requirements: GIT-01, GIT-02, GIT-03
 */

import { execSync, type ExecSyncOptions } from "node:child_process";

/**
 * Type for an injectable executor function (same signature as execSync
 * when called with string command + options returning string).
 */
export type ExecFn = (
  command: string,
  options?: ExecSyncOptions,
) => string | Buffer;

export interface GitOptions {
  cwd?: string;
  execFn?: ExecFn;
}

/**
 * Internal helper: run a git command and return trimmed stdout as string.
 * Catches execSync errors and throws descriptive messages with stderr.
 */
function runGit(
  command: string,
  opts: GitOptions = {},
): string {
  const { cwd = process.cwd(), execFn = execSync } = opts;
  try {
    const result = execFn(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return String(result).trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string | Buffer; message?: string };
    const stderr = error.stderr
      ? String(error.stderr).trim()
      : error.message ?? "Unknown git error";
    throw new Error(`Git command failed: ${command}\n${stderr}`);
  }
}

/**
 * Returns the current branch name.
 */
export function getCurrentBranch(opts?: GitOptions): string {
  return runGit("git rev-parse --abbrev-ref HEAD", opts);
}

/**
 * Returns true if the current branch matches the given name.
 */
export function isOnBranch(branchName: string, opts?: GitOptions): boolean {
  return getCurrentBranch(opts) === branchName;
}

/**
 * Creates and checks out a phase branch (phase-{phaseNumber}) from main.
 *
 * - If already on that branch, no-op.
 * - If branch already exists, checks it out.
 * - Otherwise, creates it from main.
 */
export function createPhaseBranch(
  phaseNumber: number,
  opts?: GitOptions,
): void {
  const branchName = `phase-${phaseNumber}`;

  // Already on the target branch -- no-op
  if (isOnBranch(branchName, opts)) {
    return;
  }

  // Branch already exists -- check it out
  if (branchExists(branchName, opts)) {
    runGit(`git checkout ${branchName}`, opts);
    return;
  }

  // Create new branch from main
  runGit(`git checkout -b ${branchName} main`, opts);
}

/**
 * Stages files and commits with requirement IDs in the message.
 *
 * Commit format:
 *   Subject: feat({reqIds}): {message}
 *   Body:    Requirement: {reqIds}\nPhase: {phaseNumber}
 *
 * If no files provided, uses `git add -A`.
 * Returns the commit hash.
 */
export function commitWithReqId(
  requirementIds: string[],
  message: string,
  files: string[],
  phaseNumber: number,
  opts?: GitOptions,
): string {
  // Stage files
  if (files.length === 0) {
    runGit("git add -A", opts);
  } else {
    for (const file of files) {
      runGit(`git add "${file}"`, opts);
    }
  }

  const reqIds = requirementIds.join(",");
  const subject = `feat(${reqIds}): ${message}`;
  const body = `Requirement: ${reqIds}\nPhase: ${phaseNumber}`;

  // Use -m twice: first for subject, second for body
  runGit(
    `git commit -m "${escapeDoubleQuotes(subject)}" -m "${escapeDoubleQuotes(body)}"`,
    opts,
  );

  return runGit("git rev-parse HEAD", opts);
}

/**
 * Merges the phase branch to main with --no-ff and deletes it.
 *
 * 1. Checkout main
 * 2. Merge phase-{phaseNumber} with --no-ff
 * 3. Delete the phase branch
 */
export function mergePhaseBranch(
  phaseNumber: number,
  opts?: GitOptions,
): void {
  const branchName = `phase-${phaseNumber}`;

  runGit("git checkout main", opts);
  runGit(
    `git merge --no-ff ${branchName} -m "merge: phase ${phaseNumber} verified"`,
    opts,
  );
  runGit(`git branch -d ${branchName}`, opts);
}

/**
 * Returns true if there are uncommitted changes in the working tree.
 */
export function hasUncommittedChanges(opts?: GitOptions): boolean {
  const output = runGit("git status --porcelain", opts);
  return output.length > 0;
}

/**
 * Returns true if a branch with the given name exists locally.
 */
export function branchExists(
  branchName: string,
  opts?: GitOptions,
): boolean {
  const output = runGit(`git branch --list ${branchName}`, opts);
  return output.length > 0;
}

/**
 * Escape double quotes for shell command embedding.
 */
function escapeDoubleQuotes(str: string): string {
  return str.replace(/"/g, '\\"');
}
