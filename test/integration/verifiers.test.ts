/**
 * Verifier Registry Integration Tests (VER-09)
 *
 * Tests the real registry with real verifier functions but mocked
 * external dependencies (child_process, fs). Verifies the wiring
 * between registry and verifiers is correct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "../../src/verifiers/types.js";
import { getDefaultConfig } from "../../src/config/index.js";
import type { ForgeConfig } from "../../src/config/schema.js";

// Mock external dependencies that verifiers use
vi.mock("../../src/verifiers/utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { execWithTimeout } from "../../src/verifiers/utils.js";
import { runVerifiers, getEnabledVerifiers } from "../../src/verifiers/index.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

function makeConfigWithVerification(
  verification: Partial<ForgeConfig["verification"]>,
  extraConfig: Partial<VerifierConfig> = {},
): VerifierConfig {
  const config = getDefaultConfig();
  return {
    cwd: "/project",
    forgeConfig: {
      ...config,
      verification: { ...config.verification, ...verification },
    },
    ...extraConfig,
  };
}

describe("Integration: Verifier Registry with Real Verifiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestIntegration_RunVerifiers_RealVerifiers", () => {
    it("all pass when external tools succeed and files exist", async () => {
      // Files verifier: expected files exist
      const config = makeConfig({
        expectedFiles: ["src/index.ts", "package.json"],
      });

      // fs.existsSync: true for expected files and tsconfig.json
      mockedExistsSync.mockReturnValue(true);

      // exec: tsc, lint, tests all succeed
      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("tsc")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("eslint")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          // Coverage: no new source files
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      // Tests verifier: JSON output file
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 50,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 50,
          success: true,
        }),
      );

      const report = await runVerifiers(config);

      expect(report.passed).toBe(true);
      // Default config: 5 enabled (files, tests, typecheck, lint, coverage)
      expect(report.results).toHaveLength(5);
      expect(report.summary.passed + report.summary.skipped).toBe(report.summary.total);
      expect(report.summary.failed).toBe(0);
    });
  });

  describe("TestIntegration_RunVerifiers_MixedResults", () => {
    it("report.passed is false when tsc returns errors, others pass", async () => {
      const config = makeConfig({
        expectedFiles: ["src/index.ts"],
      });

      // fs.existsSync: true for everything
      mockedExistsSync.mockReturnValue(true);

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("tsc")) {
          return {
            stdout: "src/index.ts(10,5): error TS2345: Argument of type 'string' is not assignable",
            stderr: "",
            exitCode: 1,
          };
        }
        if (command.includes("eslint")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 10,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 10,
          success: true,
        }),
      );

      const report = await runVerifiers(config);

      expect(report.passed).toBe(false);
      expect(report.summary.failed).toBeGreaterThanOrEqual(1);

      // Typecheck specifically should have failed
      const typecheckResult = report.results.find((r) => r.verifier === "typecheck");
      expect(typecheckResult).toBeDefined();
      expect(typecheckResult!.passed).toBe(false);
      expect(typecheckResult!.errors.length).toBeGreaterThan(0);

      // Other verifiers should still be in results
      const verifierNames = report.results.map((r) => r.verifier);
      expect(verifierNames).toContain("files");
      expect(verifierNames).toContain("tests");
      expect(verifierNames).toContain("lint");
    });
  });

  describe("TestIntegration_RunVerifiers_DockerGating", () => {
    it("docker result in report when all non-docker pass", async () => {
      const config = makeConfigWithVerification(
        {
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          dockerSmoke: true,
        },
        { expectedFiles: ["src/index.ts"] },
      );

      mockedExistsSync.mockReturnValue(true);

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("docker compose")) {
          if (command.includes("up")) {
            return { stdout: "Services started", stderr: "", exitCode: 0 };
          }
          if (command.includes("down")) {
            return { stdout: "Cleaned up", stderr: "", exitCode: 0 };
          }
        }
        if (command.includes("tsc")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("eslint")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = String(filePath);
        if (pathStr.includes("docker-compose")) {
          return "version: '3'\nservices:\n  app:\n    build: .";
        }
        // Tests JSON output
        return JSON.stringify({
          numPassedTests: 10,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 10,
          success: true,
        });
      });

      const report = await runVerifiers(config);

      // Docker should have run and be in the results
      const dockerResult = report.results.find((r) => r.verifier === "docker");
      expect(dockerResult).toBeDefined();
      expect(dockerResult!.passed).toBe(true);
      expect(report.results.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("TestIntegration_RunVerifiers_SkipMissingPrerequisites", () => {
    it("typecheck skipped when no tsconfig.json, others still run", async () => {
      const config = makeConfig({
        expectedFiles: ["src/index.ts"],
      });

      // tsconfig.json does NOT exist, but other files do
      mockedExistsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        if (pathStr.includes("tsconfig.json")) return false;
        return true;
      });

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("eslint")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          // Coverage: git fails
          return { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 5,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 5,
          success: true,
        }),
      );

      const report = await runVerifiers(config);

      // Typecheck should be skipped
      const typecheckResult = report.results.find((r) => r.verifier === "typecheck");
      expect(typecheckResult).toBeDefined();
      expect(typecheckResult!.passed).toBe(true);
      expect(typecheckResult!.details[0]).toContain("Skipped");

      // Coverage should be skipped (git not available)
      const coverageResult = report.results.find((r) => r.verifier === "coverage");
      expect(coverageResult).toBeDefined();
      expect(coverageResult!.passed).toBe(true);
      expect(coverageResult!.details[0]).toContain("Skipped");

      // Files and tests and lint should still run
      expect(report.results.find((r) => r.verifier === "files")).toBeDefined();
      expect(report.results.find((r) => r.verifier === "tests")).toBeDefined();
      expect(report.results.find((r) => r.verifier === "lint")).toBeDefined();
    });
  });

  describe("TestIntegration_RunVerifiers_ConfigToggles", () => {
    it("only runs enabled verifiers when lint and typecheck disabled", async () => {
      const config = makeConfigWithVerification(
        {
          files: true,
          tests: true,
          typecheck: false,
          lint: false,
          testCoverageCheck: true,
        },
        { expectedFiles: ["src/index.ts"] },
      );

      mockedExistsSync.mockReturnValue(true);

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 20,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 20,
          success: true,
        }),
      );

      const report = await runVerifiers(config);

      // Only 3 results: files, tests, coverage
      expect(report.results).toHaveLength(3);
      const verifierNames = report.results.map((r) => r.verifier);
      expect(verifierNames).toContain("files");
      expect(verifierNames).toContain("tests");
      expect(verifierNames).toContain("coverage");
      expect(verifierNames).not.toContain("typecheck");
      expect(verifierNames).not.toContain("lint");
    });
  });
});
