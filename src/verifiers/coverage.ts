/**
 * Coverage Verifier (VER-05)
 *
 * Checks that new source files have corresponding test files.
 * Detects source directories automatically instead of hardcoding src/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Verifier, VerifierResult } from "./types.js";
import { skippedResult } from "./types.js";
import { execWithTimeout } from "./utils.js";

const EXCLUDE_PATTERNS = [
  /\.test\.(ts|tsx|js|jsx)$/,
  /\.spec\.(ts|tsx|js|jsx)$/,
  /\.d\.ts$/,
  /\/index\.(ts|tsx|js|jsx)$/,
  /\/types\.(ts|tsx|js|jsx)$/,
  /\.config\.(ts|js|mjs)$/,
  /\/layout\.(ts|tsx)$/,
  /\/loading\.(ts|tsx)$/,
  /\/error\.(ts|tsx)$/,
  /\/not-found\.(ts|tsx)$/,
];

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx)$/;

/** Directories that contain source code (not config/build artifacts). */
const SOURCE_DIRS = ["src", "app", "lib", "components", "pages", "utils", "hooks", "services"];

function isSourceFile(filePath: string): boolean {
  if (!SOURCE_EXTENSIONS.test(filePath)) return false;
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath))) return false;
  // Check if file is in a source directory
  const firstDir = filePath.split("/")[0];
  return SOURCE_DIRS.includes(firstDir);
}

/**
 * Verify that new source files have corresponding test files.
 *
 * Requirement: VER-05
 */
export const coverageVerifier: Verifier = async (config): Promise<VerifierResult> => {
  const gitRef = config.gitRef ?? "main";

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

  const sourceFiles = newFiles.filter(isSourceFile);

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

function findTestFile(cwd: string, sourceFile: string): string | null {
  const ext = path.extname(sourceFile);
  const base = sourceFile.slice(0, -ext.length);

  // Pattern 1: Co-located .test
  const colocatedTest = `${base}.test${ext}`;
  if (fs.existsSync(path.resolve(cwd, colocatedTest))) return colocatedTest;

  // Pattern 2: Co-located .spec
  const colocatedSpec = `${base}.spec${ext}`;
  if (fs.existsSync(path.resolve(cwd, colocatedSpec))) return colocatedSpec;

  // Pattern 3: Separate test directory (strip first dir segment)
  const parts = sourceFile.split("/");
  if (parts.length > 1) {
    const relativePath = parts.slice(1).join("/");
    const relativeBase = relativePath.slice(0, -ext.length);

    const separateTest = `test/${relativeBase}.test${ext}`;
    if (fs.existsSync(path.resolve(cwd, separateTest))) return separateTest;

    const separateUnitTest = `test/unit/${relativeBase}.test${ext}`;
    if (fs.existsSync(path.resolve(cwd, separateUnitTest))) return separateUnitTest;

    // Pattern 4: __tests__ directory
    const dirName = path.dirname(sourceFile);
    const fileName = path.basename(sourceFile, ext);
    const testsDir = `${dirName}/__tests__/${fileName}.test${ext}`;
    if (fs.existsSync(path.resolve(cwd, testsDir))) return testsDir;
  }

  return null;
}
