/**
 * Lint Verifier Unit Tests
 *
 * Tests for the lint verifier (VER-04).
 * Mocks execWithTimeout to simulate eslint behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

vi.mock("./utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

import { execWithTimeout } from "./utils.js";
import { lintVerifier } from "./lint.js";

const mockedExec = vi.mocked(execWithTimeout);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Lint Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestLintVerifier_CleanLint", () => {
    it("passes when eslint exits 0", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const result = await lintVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("lint");
      expect(result.details[0]).toContain("passed");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("TestLintVerifier_LintErrors", () => {
    it("fails when eslint exits non-zero and captures errors", async () => {
      const lintOutput = [
        "/project/src/index.ts",
        "  3:10  error  'unused' is defined but never used  @typescript-eslint/no-unused-vars",
        "  7:1   error  Missing return type  @typescript-eslint/explicit-function-return-type",
        "",
        "2 problems (2 errors, 0 warnings)",
      ].join("\n");

      mockedExec.mockResolvedValue({
        stdout: lintOutput,
        stderr: "",
        exitCode: 1,
      });

      const result = await lintVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("lint");
      expect(result.details[0]).toContain("failed");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("no-unused-vars"))).toBe(true);
    });
  });

  describe("TestLintVerifier_CommandTimeout", () => {
    it("fails on timeout", async () => {
      mockedExec.mockResolvedValue({
        stdout: "",
        stderr: "Command timed out",
        exitCode: 1,
      });

      const result = await lintVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("lint");
    });
  });

  describe("TestLintVerifier_LimitsErrorOutput", () => {
    it("limits error output to 50 lines", async () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `  ${i + 1}:1  error  Some lint error  some-rule`,
      );

      mockedExec.mockResolvedValue({
        stdout: lines.join("\n"),
        stderr: "",
        exitCode: 1,
      });

      const result = await lintVerifier(makeConfig());

      expect(result.errors.length).toBeLessThanOrEqual(50);
    });
  });
});
