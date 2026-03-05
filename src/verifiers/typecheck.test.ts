/**
 * Typecheck Verifier Unit Tests
 *
 * Tests for the typecheck verifier (VER-03).
 * Mocks fs.existsSync and execWithTimeout.
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
import { typecheckVerifier } from "./typecheck.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Typecheck Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestTypecheckVerifier_CleanCompilation", () => {
    it("passes when tsc exits 0 with no errors", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const result = await typecheckVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("typecheck");
      expect(result.details[0]).toContain("0 error(s)");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("TestTypecheckVerifier_CompilationErrors", () => {
    it("fails and parses tsc error output", async () => {
      mockedExistsSync.mockReturnValue(true);

      const tscOutput = [
        "src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
        "src/utils.ts(25,3): error TS2304: Cannot find name 'foo'.",
      ].join("\n");

      mockedExec.mockResolvedValue({
        stdout: tscOutput,
        stderr: "",
        exitCode: 2,
      });

      const result = await typecheckVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("typecheck");
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toContain("src/index.ts:10:5");
      expect(result.errors[0]).toContain("TS2345");
      expect(result.errors[1]).toContain("src/utils.ts:25:3");
      expect(result.errors[1]).toContain("TS2304");
      expect(result.details[0]).toContain("2 error(s)");
    });
  });

  describe("TestTypecheckVerifier_NoTsconfig", () => {
    it("skips when tsconfig.json is missing", async () => {
      mockedExistsSync.mockReturnValue(false);

      const result = await typecheckVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("typecheck");
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("tsconfig.json");
    });
  });

  describe("TestTypecheckVerifier_ErrorParsing", () => {
    it("correctly extracts file, line, col, code, and message from tsc output", async () => {
      mockedExistsSync.mockReturnValue(true);

      const tscOutput =
        "src/deep/nested/file.ts(100,42): error TS9999: Some custom error message here.";

      mockedExec.mockResolvedValue({
        stdout: tscOutput,
        stderr: "",
        exitCode: 2,
      });

      const result = await typecheckVerifier(makeConfig());

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe(
        "src/deep/nested/file.ts:100:42 - TS9999: Some custom error message here.",
      );
    });

    it("limits error output to 20 errors", async () => {
      mockedExistsSync.mockReturnValue(true);

      const lines = Array.from(
        { length: 30 },
        (_, i) => `src/file.ts(${i + 1},1): error TS0001: Error ${i}`,
      );

      mockedExec.mockResolvedValue({
        stdout: lines.join("\n"),
        stderr: "",
        exitCode: 2,
      });

      const result = await typecheckVerifier(makeConfig());

      expect(result.errors).toHaveLength(20);
    });
  });
});
