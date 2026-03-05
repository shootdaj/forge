/**
 * Git Workflow Utilities Unit Tests
 *
 * Tests all git utility functions using real temporary git repos.
 * Each test creates a fresh temp directory with `git init`.
 *
 * Requirements: GIT-01, GIT-02, GIT-03
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  getCurrentBranch,
  isOnBranch,
  createPhaseBranch,
  commitWithReqId,
  mergePhaseBranch,
  hasUncommittedChanges,
  branchExists,
} from "./git.js";

/** Helper: run a git command in the temp dir */
function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

describe("Git Workflow Utilities", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-git-test-"));

    // Initialize a git repo with an initial commit on main
    git("git init -b main", tmpDir);
    git('git config user.email "test@forge.dev"', tmpDir);
    git('git config user.name "Forge Test"', tmpDir);
    git("git commit --allow-empty -m 'init'", tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // getCurrentBranch
  // -----------------------------------------------------------------------

  describe("TestGetCurrentBranch_ReturnsCorrectBranch", () => {
    it("returns main for a freshly initialized repo", () => {
      const branch = getCurrentBranch({ cwd: tmpDir });
      expect(branch).toBe("main");
    });

    it("returns the branch name after switching", () => {
      git("git checkout -b feature-x", tmpDir);
      const branch = getCurrentBranch({ cwd: tmpDir });
      expect(branch).toBe("feature-x");
    });
  });

  // -----------------------------------------------------------------------
  // isOnBranch
  // -----------------------------------------------------------------------

  describe("TestIsOnBranch_MatchesCurrentBranch", () => {
    it("returns true when on the specified branch", () => {
      expect(isOnBranch("main", { cwd: tmpDir })).toBe(true);
    });

    it("returns false when on a different branch", () => {
      expect(isOnBranch("feature-y", { cwd: tmpDir })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // createPhaseBranch
  // -----------------------------------------------------------------------

  describe("TestCreatePhaseBranch_CreatesAndSwitches", () => {
    it("creates the branch and switches to it", () => {
      createPhaseBranch(3, { cwd: tmpDir });

      const branch = getCurrentBranch({ cwd: tmpDir });
      expect(branch).toBe("phase-3");
      expect(branchExists("phase-3", { cwd: tmpDir })).toBe(true);
    });

    it("is idempotent when already on the branch", () => {
      createPhaseBranch(3, { cwd: tmpDir });
      // Call again -- should not throw
      createPhaseBranch(3, { cwd: tmpDir });

      const branch = getCurrentBranch({ cwd: tmpDir });
      expect(branch).toBe("phase-3");
    });

    it("checks out existing branch if not currently on it", () => {
      // Create phase-5 branch then switch back to main
      createPhaseBranch(5, { cwd: tmpDir });
      git("git checkout main", tmpDir);
      expect(getCurrentBranch({ cwd: tmpDir })).toBe("main");

      // Call again -- should switch to existing branch, not error
      createPhaseBranch(5, { cwd: tmpDir });
      expect(getCurrentBranch({ cwd: tmpDir })).toBe("phase-5");
    });
  });

  // -----------------------------------------------------------------------
  // commitWithReqId
  // -----------------------------------------------------------------------

  describe("TestCommitWithReqId_FormatsCorrectly", () => {
    it("formats commit message with requirement IDs", () => {
      // Create a file to commit
      fs.writeFileSync(path.join(tmpDir, "hello.ts"), "export const x = 1;");

      const hash = commitWithReqId(
        ["R1"],
        "implement user registration endpoint",
        ["hello.ts"],
        3,
        { cwd: tmpDir },
      );

      expect(hash).toMatch(/^[0-9a-f]{40}$/);

      // Verify commit message subject
      const subject = git("git log -1 --pretty=%s", tmpDir);
      expect(subject).toBe(
        "feat(R1): implement user registration endpoint",
      );
    });

    it("includes phase number in commit body", () => {
      fs.writeFileSync(path.join(tmpDir, "auth.ts"), "export {};");

      commitWithReqId(["R1"], "add auth", ["auth.ts"], 3, {
        cwd: tmpDir,
      });

      const body = git("git log -1 --pretty=%b", tmpDir);
      expect(body).toContain("Requirement: R1");
      expect(body).toContain("Phase: 3");
    });

    it("handles multiple requirement IDs", () => {
      fs.writeFileSync(path.join(tmpDir, "multi.ts"), "export {};");

      commitWithReqId(
        ["R1", "R2", "R3"],
        "implement multiple features",
        ["multi.ts"],
        5,
        { cwd: tmpDir },
      );

      const subject = git("git log -1 --pretty=%s", tmpDir);
      expect(subject).toBe(
        "feat(R1,R2,R3): implement multiple features",
      );

      const body = git("git log -1 --pretty=%b", tmpDir);
      expect(body).toContain("Requirement: R1,R2,R3");
      expect(body).toContain("Phase: 5");
    });

    it("uses git add -A when no files specified", () => {
      fs.writeFileSync(path.join(tmpDir, "auto1.ts"), "export {};");
      fs.writeFileSync(path.join(tmpDir, "auto2.ts"), "export {};");

      commitWithReqId(["R10"], "auto stage all", [], 1, {
        cwd: tmpDir,
      });

      // Both files should be in the commit
      const files = git("git diff-tree --no-commit-id --name-only -r HEAD", tmpDir);
      expect(files).toContain("auto1.ts");
      expect(files).toContain("auto2.ts");
    });
  });

  describe("TestCommitWithReqId_ThrowsWhenNothingToCommit", () => {
    it("throws when there are no staged changes and no files", () => {
      expect(() =>
        commitWithReqId(["R1"], "empty commit", [], 1, {
          cwd: tmpDir,
        }),
      ).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // mergePhaseBranch
  // -----------------------------------------------------------------------

  describe("TestMergePhaseBranch_MergesAndDeletesBranch", () => {
    it("merges to main and deletes the phase branch", () => {
      // Create phase branch and make a commit
      createPhaseBranch(7, { cwd: tmpDir });
      fs.writeFileSync(path.join(tmpDir, "feature.ts"), "export {};");
      commitWithReqId(["GIT-01"], "add feature", ["feature.ts"], 7, {
        cwd: tmpDir,
      });

      // Merge back
      mergePhaseBranch(7, { cwd: tmpDir });

      // Should be on main
      expect(getCurrentBranch({ cwd: tmpDir })).toBe("main");
      // Branch should be deleted
      expect(branchExists("phase-7", { cwd: tmpDir })).toBe(false);
      // File should exist on main (merged)
      expect(fs.existsSync(path.join(tmpDir, "feature.ts"))).toBe(true);

      // Merge commit should have the expected message
      const subject = git("git log -1 --pretty=%s", tmpDir);
      expect(subject).toBe("merge: phase 7 verified");
    });
  });

  // -----------------------------------------------------------------------
  // hasUncommittedChanges
  // -----------------------------------------------------------------------

  describe("TestHasUncommittedChanges_DetectsModifiedFiles", () => {
    it("returns false when working tree is clean", () => {
      expect(hasUncommittedChanges({ cwd: tmpDir })).toBe(false);
    });

    it("returns true when there are untracked files", () => {
      fs.writeFileSync(path.join(tmpDir, "new-file.ts"), "export {};");
      expect(hasUncommittedChanges({ cwd: tmpDir })).toBe(true);
    });

    it("returns true when there are modified files", () => {
      // Create and commit a file, then modify it
      fs.writeFileSync(path.join(tmpDir, "mod.ts"), "export const a = 1;");
      git("git add mod.ts", tmpDir);
      git('git commit -m "add mod"', tmpDir);

      fs.writeFileSync(path.join(tmpDir, "mod.ts"), "export const a = 2;");
      expect(hasUncommittedChanges({ cwd: tmpDir })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // branchExists
  // -----------------------------------------------------------------------

  describe("TestBranchExists_ReturnsCorrectBoolean", () => {
    it("returns true for existing branch", () => {
      expect(branchExists("main", { cwd: tmpDir })).toBe(true);
    });

    it("returns false for non-existent branch", () => {
      expect(branchExists("does-not-exist", { cwd: tmpDir })).toBe(false);
    });

    it("returns true after creating a new branch", () => {
      git("git checkout -b test-branch", tmpDir);
      expect(branchExists("test-branch", { cwd: tmpDir })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("TestGitErrors_DescriptiveMessages", () => {
    it("throws descriptive error when git command fails", () => {
      // Use a non-git directory
      const nonGitDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "forge-no-git-"),
      );
      try {
        expect(() => getCurrentBranch({ cwd: nonGitDir })).toThrow(
          /Git command failed/,
        );
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });
});
