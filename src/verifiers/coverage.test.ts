/**
 * Coverage Verifier Unit Tests
 *
 * Tests for the coverage verifier (VER-05).
 * Mocks execWithTimeout and fs to simulate git diff and file existence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

vi.mock("./utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { execWithTimeout } from "./utils.js";
import { coverageVerifier } from "./coverage.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Coverage Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestCoverageVerifier_AllFilesCovered", () => {
    it("passes when every new source file has a test file", async () => {
      mockedExec.mockResolvedValue({
        stdout: "src/utils/helper.ts\nsrc/api/routes.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // For each source file, the first existsSync call (co-located .test) returns true
      mockedExistsSync.mockReturnValue(true);

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("coverage");
      expect(result.errors).toHaveLength(0);
      expect(result.details).toHaveLength(2);
    });
  });

  describe("TestCoverageVerifier_MissingTests", () => {
    it("fails when some source files lack test files", async () => {
      mockedExec.mockResolvedValue({
        stdout: "src/api/routes.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // All existsSync calls return false (no test file found)
      mockedExistsSync.mockReturnValue(false);

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("src/api/routes.ts");
    });
  });

  describe("TestCoverageVerifier_ExcludesTestFiles", () => {
    it("does not check .test.ts, .spec.ts, .d.ts files for coverage", async () => {
      mockedExec.mockResolvedValue({
        stdout: [
          "src/api/routes.test.ts",
          "src/api/routes.spec.ts",
          "src/types/global.d.ts",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("No new source files");
    });
  });

  describe("TestCoverageVerifier_ExcludesIndexAndTypes", () => {
    it("excludes index.ts and types.ts from coverage check", async () => {
      mockedExec.mockResolvedValue({
        stdout: "src/verifiers/index.ts\nsrc/verifiers/types.ts\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("No new source files");
    });
  });

  describe("TestCoverageVerifier_GitNotAvailable", () => {
    it("skips when git command fails", async () => {
      mockedExec.mockResolvedValue({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      });

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("Git not available");
    });
  });

  describe("TestCoverageVerifier_ColocatedAndSeparatePatterns", () => {
    it("checks both co-located and separate directory patterns", async () => {
      mockedExec.mockResolvedValue({
        stdout: "src/api/handler.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // First call (co-located .test.ts): false
      // Second call (co-located .spec.ts): false
      // Third call (test/api/handler.test.ts): true
      mockedExistsSync
        .mockReturnValueOnce(false) // src/api/handler.test.ts
        .mockReturnValueOnce(false) // src/api/handler.spec.ts
        .mockReturnValueOnce(true); // test/api/handler.test.ts

      const result = await coverageVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("test/api/handler.test.ts");
    });
  });
});
