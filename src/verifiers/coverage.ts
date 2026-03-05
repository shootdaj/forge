/**
 * Coverage Verifier (VER-05)
 *
 * Checks that new source files (from git diff) have corresponding test files.
 * Uses co-located and separate directory patterns to find tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

/**
 * File patterns to exclude from coverage checks.
 * These are files that typically don't need their own test files.
 */
const EXCLUDE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.d\.ts$/,
  /\/index\.(ts|tsx|js|jsx)$/, // barrel files
  /\/types\.(ts|tsx|js|jsx)$/, // pure type files
];

/**
 * Source file extensions to check for test coverage.
 */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx)$/;

/**
 * Verify that new source files have corresponding test files.
 *
 * Behavior:
 * - Run git diff to find newly added source files since gitRef (default: "main")
 * - Filter to .ts/.tsx/.js/.jsx files in src/ directory
 * - Exclude test files, type files, barrel files, declaration files
 * - Check for corresponding test files in co-located and separate directory patterns
 * - Skip if git command fails (not a git repo, no commits)
 *
 * Requirement: VER-05
 */
export const coverageVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const gitRef = config.gitRef ?? "main";

  // Get new source files from git diff
  const diffResult = await execWithTimeout(
    `git diff --name-only --diff-filter=A ${gitRef}...HEAD`,
    config.cwd,
    15_000,
  );

  if (diffResult.exitCode !== 0) {
    return skippedResult("coverage", "Git not available or no commits");
  }

  const newFiles = diffResult.stdout
    .trim()
    .split("\n")
    .filter((f) => f.trim().length > 0);

  // Filter to source files in src/ directory
  const sourceFiles = newFiles.filter((f) => {
    if (!f.startsWith("src/")) return false;
    if (!SOURCE_EXTENSIONS.test(f)) return false;
    if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(f))) return false;
    return true;
  });

  if (sourceFiles.length === 0) {
    return {
      passed: true,
      verifier: "coverage",
      details: ["No new source files to check for test coverage"],
      errors: [],
    };
  }

  const details: string[] = [];
  const errors: string[] = [];

  for (const sourceFile of sourceFiles) {
    const testFile = findTestFile(config.cwd, sourceFile);
    if (testFile) {
      details.push(`${sourceFile} -> ${testFile}`);
    } else {
      details.push(`${sourceFile} -> MISSING`);
      errors.push(`No test file found for: ${sourceFile}`);
    }
  }

  return {
    passed: errors.length === 0,
    verifier: "coverage",
    details,
    errors,
  };
};

/**
 * Find a corresponding test file for a source file.
 * Checks patterns in order of preference:
 * 1. Co-located: src/foo.test.ts
 * 2. Co-located alt: src/foo.spec.ts
 * 3. Separate dir: test/{relative}/foo.test.ts
 * 4. Separate dir tiered: test/unit/{relative}/foo.test.ts
 *
 * @returns The test file path (relative) if found, null otherwise
 */
function findTestFile(cwd: string, sourceFile: string): string | null {
  const ext = path.extname(sourceFile);
  const base = sourceFile.slice(0, -ext.length);

  // Pattern 1: Co-located .test
  const colocatedTest = `${base}.test${ext}`;
  if (fs.existsSync(path.resolve(cwd, colocatedTest))) {
    return colocatedTest;
  }

  // Pattern 2: Co-located .spec
  const colocatedSpec = `${base}.spec${ext}`;
  if (fs.existsSync(path.resolve(cwd, colocatedSpec))) {
    return colocatedSpec;
  }

  // Pattern 3: Separate test directory
  // src/verifiers/files.ts -> test/verifiers/files.test.ts
  const relativePath = sourceFile.replace(/^src\//, "");
  const relativeBase = relativePath.slice(0, -ext.length);
  const separateTest = `test/${relativeBase}.test${ext}`;
  if (fs.existsSync(path.resolve(cwd, separateTest))) {
    return separateTest;
  }

  // Pattern 4: Separate test/unit directory
  const separateUnitTest = `test/unit/${relativeBase}.test${ext}`;
  if (fs.existsSync(path.resolve(cwd, separateUnitTest))) {
    return separateUnitTest;
  }

  return null;
}
