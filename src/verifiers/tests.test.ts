/**
 * Tests Verifier Unit Tests
 *
 * Tests for the tests verifier (VER-02).
 * Mocks child_process.exec and fs to simulate test runner behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

// We need to mock execWithTimeout since tests.ts uses it
vi.mock("./utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

// Mock fs for reading the temp file
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { execWithTimeout } from "./utils.js";
import { testsVerifier } from "./tests.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedUnlinkSync = vi.mocked(fs.unlinkSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Tests Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: temp file cleanup works fine
    mockedUnlinkSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestTestsVerifier_AllTestsPass", () => {
    it("passes when all tests pass (vitest JSON format)", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 10,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 10,
          success: true,
        }),
      );

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("tests");
      expect(result.details[0]).toContain("10 passed");
      expect(result.details[0]).toContain("0 failed");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("TestTestsVerifier_SomeTestsFail", () => {
    it("fails when some tests fail", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 8,
          numFailedTests: 2,
          numPendingTests: 0,
          numTotalTests: 10,
          success: false,
        }),
      );

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("tests");
      expect(result.errors.some((e) => e.includes("numFailedTests: 2"))).toBe(true);
    });
  });

  describe("TestTestsVerifier_NoTestsRun", () => {
    it("fails when no tests passed (numPassedTests === 0)", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 0,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 0,
          success: true,
        }),
      );

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("numPassedTests === 0"))).toBe(true);
    });
  });

  describe("TestTestsVerifier_JSONParseFails_FallbackToExitCode", () => {
    it("falls back to exit code when JSON parsing fails", async () => {
      mockedExec.mockResolvedValue({ stdout: "All tests passed", stderr: "", exitCode: 0 });
      // Temp file does not exist
      mockedExistsSync.mockReturnValue(false);

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("tests");
      expect(result.details[0]).toContain("JSON output not available");
    });

    it("falls back to exit code failure when JSON unavailable and exit code non-zero", async () => {
      mockedExec.mockResolvedValue({
        stdout: "",
        stderr: "Error: test failed",
        exitCode: 1,
      });
      mockedExistsSync.mockReturnValue(false);

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("exit code 1"))).toBe(true);
    });
  });

  describe("TestTestsVerifier_CommandTimeout", () => {
    it("fails on timeout with error details", async () => {
      mockedExec.mockResolvedValue({
        stdout: "",
        stderr: "Timeout - process killed",
        exitCode: 1,
      });
      mockedExistsSync.mockReturnValue(false);

      const result = await testsVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("tests");
    });
  });
});
