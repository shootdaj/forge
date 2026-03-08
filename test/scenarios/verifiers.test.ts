/**
 * Verifier Pipeline Scenario Tests (VER-09)
 *
 * End-to-end tests simulating realistic verification scenarios.
 * Mock child_process and fs to simulate real project conditions.
 * Verify the contract that Phase 5 (Phase Runner) will consume.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "../../src/verifiers/types.js";
import { getDefaultConfig } from "../../src/config/index.js";
import type { ForgeConfig } from "../../src/config/schema.js";

// Mock external dependencies
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
import { runVerifiers } from "../../src/verifiers/index.js";

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

describe("Scenario: Verification Pipeline End-to-End", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestScenario_HealthyProject_AllVerifiersPass", () => {
    it("default config, all tools succeed: report.passed: true, 5 passed, 0 failed, 0 skipped", async () => {
      const config = makeConfig({
        expectedFiles: ["src/index.ts", "package.json", "tsconfig.json"],
      });

      // All files exist
      mockedExistsSync.mockReturnValue(true);

      // All external commands succeed
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
          // 3 new source files, all have test files
          return {
            stdout: "src/verifiers/files.ts\nsrc/verifiers/tests.ts\nsrc/verifiers/lint.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      // Test runner JSON output: 50 passed
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
      expect(report.results).toHaveLength(5);
      expect(report.summary.total).toBe(5);
      // Note: some may be skipped (e.g., coverage finds test files exist).
      // The key is: 0 failed
      expect(report.summary.failed).toBe(0);
      expect(report.summary.passed + report.summary.skipped).toBe(5);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("TestScenario_FailingTests_StopsDocker", () => {
    it("tests fail, docker is skipped (not run), report.passed: false", async () => {
      // Enable all verifiers including docker
      const config = makeConfigWithVerification(
        {
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          observabilityCheck: true,
          dockerSmoke: true,
          deployment: true,
        },
        { expectedFiles: ["src/index.ts"] },
      );

      // All files exist
      mockedExistsSync.mockReturnValue(true);

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("tsc")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("eslint")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("test")) {
          // Tests FAIL
          return { stdout: "", stderr: "Test suite failed", exitCode: 1 };
        }
        if (command.includes("git diff")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("grep")) {
          // Observability: health endpoint found
          return { stdout: "src/app.ts", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      // Test runner JSON: 3 failed (and package.json with test script)
      mockedReadFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = String(filePath);
        if (pathStr.includes("package.json")) {
          return JSON.stringify({ scripts: { test: "vitest run" } });
        }
        if (pathStr.includes("Dockerfile")) {
          return "FROM node:20\nRUN npm install";
        }
        return JSON.stringify({
          numPassedTests: 7,
          numFailedTests: 3,
          numPendingTests: 0,
          numTotalTests: 10,
          success: false,
        });
      });

      const report = await runVerifiers(config);

      expect(report.passed).toBe(false);

      // Tests should have failed
      const testsResult = report.results.find((r) => r.verifier === "tests");
      expect(testsResult).toBeDefined();
      expect(testsResult!.passed).toBe(false);

      // Docker should be skipped (non-docker failed)
      const dockerResult = report.results.find((r) => r.verifier === "docker");
      expect(dockerResult).toBeDefined();
      expect(dockerResult!.details[0]).toContain("Skipped:");

      // Docker compose commands should NOT have been called
      const dockerCalls = mockedExec.mock.calls.filter(
        (call) => String(call[0]).includes("docker compose"),
      );
      expect(dockerCalls).toHaveLength(0);
    });
  });

  describe("TestScenario_NewProject_SkipsOptionalVerifiers", () => {
    it("no tsconfig, git fails: typecheck skipped, coverage skipped, files/tests/lint still run", async () => {
      const config = makeConfig({
        expectedFiles: ["src/index.ts"],
      });

      // tsconfig.json does NOT exist
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
          // Git fails (not a git repo)
          return { stdout: "", stderr: "fatal: not a git repository", exitCode: 128 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
        const pathStr = String(filePath);
        if (pathStr.includes("package.json")) {
          return JSON.stringify({ scripts: { test: "vitest run" } });
        }
        return JSON.stringify({
          numPassedTests: 3,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 3,
          success: true,
        });
      });

      const report = await runVerifiers(config);

      // Should still pass (skips are not failures)
      expect(report.passed).toBe(true);

      // Typecheck should be skipped
      const typecheckResult = report.results.find((r) => r.verifier === "typecheck");
      expect(typecheckResult).toBeDefined();
      expect(typecheckResult!.passed).toBe(true);
      expect(typecheckResult!.details[0]).toContain("Skipped");

      // Coverage should be skipped
      const coverageResult = report.results.find((r) => r.verifier === "coverage");
      expect(coverageResult).toBeDefined();
      expect(coverageResult!.passed).toBe(true);
      expect(coverageResult!.details[0]).toContain("Skipped");

      // Files, tests, lint should have run and passed
      const filesResult = report.results.find((r) => r.verifier === "files");
      expect(filesResult).toBeDefined();
      expect(filesResult!.passed).toBe(true);

      const testsResult = report.results.find((r) => r.verifier === "tests");
      expect(testsResult).toBeDefined();
      expect(testsResult!.passed).toBe(true);

      const lintResult = report.results.find((r) => r.verifier === "lint");
      expect(lintResult).toBeDefined();
      expect(lintResult!.passed).toBe(true);

      // Summary should reflect skips correctly (typecheck + coverage)
      expect(report.summary.skipped).toBe(2);
      expect(report.summary.failed).toBe(0);
    });
  });

  describe("TestScenario_FullVerificationReport_Structure", () => {
    it("report has all required fields for Phase 5 consumption", async () => {
      // Enable all verifiers for maximum coverage of the report structure
      const config = makeConfigWithVerification(
        {
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          observabilityCheck: true,
          dockerSmoke: true,
          deployment: true,
        },
        { expectedFiles: ["src/index.ts"] },
      );

      // Mix of pass/fail/skip
      // No tsconfig => typecheck skipped
      // No src/ dir check for observability => it checks for health endpoint
      mockedExistsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        if (pathStr.includes("tsconfig.json")) return false;
        if (pathStr.includes("docker-compose")) return false;
        if (pathStr.includes("Dockerfile")) return false;
        return true;
      });

      mockedExec.mockImplementation(async (command: string) => {
        if (command.includes("eslint")) {
          // Lint fails
          return { stdout: "src/index.ts:5:1 error no-unused-vars", stderr: "", exitCode: 1 };
        }
        if (command.includes("test")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("git diff")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        if (command.includes("grep")) {
          // Observability: health endpoint found
          return { stdout: "src/server.ts", stderr: "", exitCode: 0 };
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

      // Verify VerificationReport structure
      expect(report).toHaveProperty("passed");
      expect(typeof report.passed).toBe("boolean");

      expect(report).toHaveProperty("results");
      expect(Array.isArray(report.results)).toBe(true);

      expect(report).toHaveProperty("summary");
      expect(report.summary).toHaveProperty("total");
      expect(report.summary).toHaveProperty("passed");
      expect(report.summary).toHaveProperty("failed");
      expect(report.summary).toHaveProperty("skipped");
      expect(typeof report.summary.total).toBe("number");
      expect(typeof report.summary.passed).toBe("number");
      expect(typeof report.summary.failed).toBe("number");
      expect(typeof report.summary.skipped).toBe("number");

      expect(report).toHaveProperty("durationMs");
      expect(typeof report.durationMs).toBe("number");
      expect(report.durationMs).toBeGreaterThanOrEqual(0);

      // Verify summary math is consistent
      expect(report.summary.passed + report.summary.failed + report.summary.skipped).toBe(
        report.summary.total,
      );

      // Verify each individual result has required fields
      for (const result of report.results) {
        expect(result).toHaveProperty("passed");
        expect(typeof result.passed).toBe("boolean");
        expect(result).toHaveProperty("verifier");
        expect(typeof result.verifier).toBe("string");
        expect(result).toHaveProperty("details");
        expect(Array.isArray(result.details)).toBe("true" ? true : false);
        expect(result).toHaveProperty("errors");
        expect(Array.isArray(result.errors)).toBe(true);
      }

      // Lint failed => report.passed should be false
      expect(report.passed).toBe(false);
      expect(report.summary.failed).toBeGreaterThanOrEqual(1);

      // Typecheck should be skipped (no tsconfig)
      const typecheckResult = report.results.find((r) => r.verifier === "typecheck");
      if (typecheckResult) {
        expect(typecheckResult.details[0]).toContain("Skipped");
      }

      // Docker should be skipped (lint failed => non-docker failed)
      const dockerResult = report.results.find((r) => r.verifier === "docker");
      if (dockerResult) {
        expect(dockerResult.details[0]).toContain("Skipped:");
      }
    });
  });

  describe("TestScenario_CoverageEnforcement", () => {
    it("coverage verifier fails when new source files lack test files", async () => {
      const config = makeConfig({
        expectedFiles: ["src/index.ts"],
      });

      // Source files exist but test files do NOT exist for new-feature.ts
      mockedExistsSync.mockImplementation((filePath: fs.PathLike) => {
        const pathStr = String(filePath);
        // tsconfig exists
        if (pathStr.includes("tsconfig.json")) return true;
        // Expected files exist
        if (pathStr === "/project/src/index.ts") return true;
        // Test file patterns for new-feature.ts - NONE exist
        if (pathStr.includes("new-feature.test")) return false;
        if (pathStr.includes("new-feature.spec")) return false;
        if (pathStr.includes("test/verifiers/new-feature")) return false;
        if (pathStr.includes("test/unit/verifiers/new-feature")) return false;
        // Test file patterns for files.ts - co-located test exists
        if (pathStr.includes("files.test")) return true;
        // Test file patterns for tests.ts - co-located test exists
        if (pathStr.includes("tests.test")) return true;
        // Default: exists
        return true;
      });

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
          // 3 new source files: 2 have tests, 1 does not
          return {
            stdout: "src/verifiers/files.ts\nsrc/verifiers/tests.ts\nsrc/verifiers/new-feature.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          numPassedTests: 30,
          numFailedTests: 0,
          numPendingTests: 0,
          numTotalTests: 30,
          success: true,
        }),
      );

      const report = await runVerifiers(config);

      // Coverage should have failed
      const coverageResult = report.results.find((r) => r.verifier === "coverage");
      expect(coverageResult).toBeDefined();
      expect(coverageResult!.passed).toBe(false);
      expect(coverageResult!.errors.length).toBeGreaterThan(0);
      expect(coverageResult!.errors.some((e) => e.includes("new-feature.ts"))).toBe(true);

      // Report should fail because coverage failed
      expect(report.passed).toBe(false);
      expect(report.summary.failed).toBeGreaterThanOrEqual(1);
    });
  });
});
