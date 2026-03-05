/**
 * Verifier Registry Unit Tests (VER-09)
 *
 * Tests for the verifier registry, getEnabledVerifiers, and runVerifiers.
 * Mocks all individual verifier modules to control their behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VerifierConfig, VerifierResult } from "./types.js";
import { getDefaultConfig } from "../config/index.js";
import type { ForgeConfig } from "../config/schema.js";

// Mock all individual verifier modules
vi.mock("./files.js", () => ({
  filesVerifier: vi.fn(),
}));
vi.mock("./tests.js", () => ({
  testsVerifier: vi.fn(),
}));
vi.mock("./typecheck.js", () => ({
  typecheckVerifier: vi.fn(),
}));
vi.mock("./lint.js", () => ({
  lintVerifier: vi.fn(),
}));
vi.mock("./coverage.js", () => ({
  coverageVerifier: vi.fn(),
}));
vi.mock("./observability.js", () => ({
  observabilityVerifier: vi.fn(),
}));
vi.mock("./docker.js", () => ({
  dockerVerifier: vi.fn(),
}));
vi.mock("./deployment.js", () => ({
  deploymentVerifier: vi.fn(),
}));

import { filesVerifier } from "./files.js";
import { testsVerifier } from "./tests.js";
import { typecheckVerifier } from "./typecheck.js";
import { lintVerifier } from "./lint.js";
import { coverageVerifier } from "./coverage.js";
import { observabilityVerifier } from "./observability.js";
import { dockerVerifier } from "./docker.js";
import { deploymentVerifier } from "./deployment.js";
import { runVerifiers, getEnabledVerifiers, verifierRegistry } from "./index.js";

const mockedFiles = vi.mocked(filesVerifier);
const mockedTests = vi.mocked(testsVerifier);
const mockedTypecheck = vi.mocked(typecheckVerifier);
const mockedLint = vi.mocked(lintVerifier);
const mockedCoverage = vi.mocked(coverageVerifier);
const mockedObservability = vi.mocked(observabilityVerifier);
const mockedDocker = vi.mocked(dockerVerifier);
const mockedDeployment = vi.mocked(deploymentVerifier);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

function makeConfigWithVerification(
  verification: Partial<ForgeConfig["verification"]>,
): VerifierConfig {
  const config = getDefaultConfig();
  return {
    cwd: "/project",
    forgeConfig: {
      ...config,
      verification: { ...config.verification, ...verification },
    },
  };
}

function passResult(verifier: string): VerifierResult {
  return {
    passed: true,
    verifier,
    details: [`${verifier} check: passed`],
    errors: [],
  };
}

function failResult(verifier: string, error: string): VerifierResult {
  return {
    passed: false,
    verifier,
    details: [`${verifier} check: failed`],
    errors: [error],
  };
}

function skipResult(verifier: string, reason: string): VerifierResult {
  return {
    passed: true,
    verifier,
    details: [`Skipped: ${reason}`],
    errors: [],
  };
}

/**
 * Set all mocked verifiers to return passing results.
 */
function mockAllPassing(): void {
  mockedFiles.mockResolvedValue(passResult("files"));
  mockedTests.mockResolvedValue(passResult("tests"));
  mockedTypecheck.mockResolvedValue(passResult("typecheck"));
  mockedLint.mockResolvedValue(passResult("lint"));
  mockedCoverage.mockResolvedValue(passResult("coverage"));
  mockedObservability.mockResolvedValue(passResult("observability"));
  mockedDocker.mockResolvedValue(passResult("docker"));
  mockedDeployment.mockResolvedValue(passResult("deployment"));
}

describe("Verifier Registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("verifierRegistry", () => {
    it("maps all 8 verifier names to functions", () => {
      const expectedNames = [
        "files",
        "tests",
        "typecheck",
        "lint",
        "coverage",
        "observability",
        "docker",
        "deployment",
      ];

      for (const name of expectedNames) {
        expect(verifierRegistry[name]).toBeDefined();
        expect(typeof verifierRegistry[name]).toBe("function");
      }

      expect(Object.keys(verifierRegistry)).toHaveLength(8);
    });
  });

  describe("getEnabledVerifiers", () => {
    describe("TestGetEnabledVerifiers_DefaultConfig", () => {
      it("returns files, tests, typecheck, lint, coverage enabled; observability, docker, deployment disabled", () => {
        const config = getDefaultConfig();
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toContain("files");
        expect(enabled).toContain("tests");
        expect(enabled).toContain("typecheck");
        expect(enabled).toContain("lint");
        expect(enabled).toContain("coverage");
        expect(enabled).not.toContain("observability");
        expect(enabled).not.toContain("docker");
        expect(enabled).not.toContain("deployment");
        expect(enabled).toHaveLength(5);
      });
    });

    describe("TestGetEnabledVerifiers_AllDisabled", () => {
      it("returns empty array when all toggles are false", () => {
        const config = getDefaultConfig();
        config.verification = {
          files: false,
          tests: false,
          typecheck: false,
          lint: false,
          dockerSmoke: false,
          testCoverageCheck: false,
          observabilityCheck: false,
          deployment: false,
        };
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toHaveLength(0);
      });
    });

    describe("TestGetEnabledVerifiers_ConfigMapping", () => {
      it("maps testCoverageCheck to coverage", () => {
        const config = getDefaultConfig();
        config.verification = {
          ...config.verification,
          files: false,
          tests: false,
          typecheck: false,
          lint: false,
          testCoverageCheck: true,
          observabilityCheck: false,
          dockerSmoke: false,
          deployment: false,
        };
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toEqual(["coverage"]);
      });

      it("maps dockerSmoke to docker", () => {
        const config = getDefaultConfig();
        config.verification = {
          ...config.verification,
          files: false,
          tests: false,
          typecheck: false,
          lint: false,
          testCoverageCheck: false,
          observabilityCheck: false,
          dockerSmoke: true,
          deployment: false,
        };
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toEqual(["docker"]);
      });

      it("maps observabilityCheck to observability", () => {
        const config = getDefaultConfig();
        config.verification = {
          ...config.verification,
          files: false,
          tests: false,
          typecheck: false,
          lint: false,
          testCoverageCheck: false,
          observabilityCheck: true,
          dockerSmoke: false,
          deployment: false,
        };
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toEqual(["observability"]);
      });

      it("maps all config keys correctly when all enabled", () => {
        const config = getDefaultConfig();
        config.verification = {
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          observabilityCheck: true,
          dockerSmoke: true,
          deployment: true,
        };
        const enabled = getEnabledVerifiers(config);

        expect(enabled).toHaveLength(8);
        expect(enabled).toContain("files");
        expect(enabled).toContain("tests");
        expect(enabled).toContain("typecheck");
        expect(enabled).toContain("lint");
        expect(enabled).toContain("coverage");
        expect(enabled).toContain("observability");
        expect(enabled).toContain("docker");
        expect(enabled).toContain("deployment");
      });
    });
  });

  describe("runVerifiers", () => {
    describe("TestRunVerifiers_AllPass_VER09", () => {
      it("reports passed: true when all enabled verifiers pass", async () => {
        mockAllPassing();

        const report = await runVerifiers(makeConfig());

        expect(report.passed).toBe(true);
        // Default config: 5 enabled (files, tests, typecheck, lint, coverage)
        expect(report.results).toHaveLength(5);
        expect(report.summary.total).toBe(5);
        expect(report.summary.passed).toBe(5);
        expect(report.summary.failed).toBe(0);
        expect(report.summary.skipped).toBe(0);
      });
    });

    describe("TestRunVerifiers_SomeFail_VER09", () => {
      it("reports passed: false when one verifier fails, all results still collected", async () => {
        mockAllPassing();
        mockedTypecheck.mockResolvedValue(failResult("typecheck", "TS2345: type mismatch"));

        const report = await runVerifiers(makeConfig());

        expect(report.passed).toBe(false);
        expect(report.results).toHaveLength(5);
        expect(report.summary.failed).toBe(1);
        expect(report.summary.passed).toBe(4);

        // Verify that all verifiers were called (not short-circuited)
        expect(mockedFiles).toHaveBeenCalled();
        expect(mockedTests).toHaveBeenCalled();
        expect(mockedTypecheck).toHaveBeenCalled();
        expect(mockedLint).toHaveBeenCalled();
        expect(mockedCoverage).toHaveBeenCalled();
      });
    });

    describe("TestRunVerifiers_ParallelExecution_VER09", () => {
      it("calls non-docker verifiers concurrently (all started before any completes)", async () => {
        const callOrder: string[] = [];
        const resolvers: Record<string, () => void> = {};

        // Each verifier records when it was called but doesn't resolve immediately
        mockedFiles.mockImplementation(() => {
          callOrder.push("files:start");
          return new Promise<VerifierResult>((resolve) => {
            resolvers["files"] = () => {
              callOrder.push("files:end");
              resolve(passResult("files"));
            };
          });
        });

        mockedTests.mockImplementation(() => {
          callOrder.push("tests:start");
          return new Promise<VerifierResult>((resolve) => {
            resolvers["tests"] = () => {
              callOrder.push("tests:end");
              resolve(passResult("tests"));
            };
          });
        });

        mockedTypecheck.mockImplementation(() => {
          callOrder.push("typecheck:start");
          return new Promise<VerifierResult>((resolve) => {
            resolvers["typecheck"] = () => {
              callOrder.push("typecheck:end");
              resolve(passResult("typecheck"));
            };
          });
        });

        mockedLint.mockImplementation(() => {
          callOrder.push("lint:start");
          return new Promise<VerifierResult>((resolve) => {
            resolvers["lint"] = () => {
              callOrder.push("lint:end");
              resolve(passResult("lint"));
            };
          });
        });

        mockedCoverage.mockImplementation(() => {
          callOrder.push("coverage:start");
          return new Promise<VerifierResult>((resolve) => {
            resolvers["coverage"] = () => {
              callOrder.push("coverage:end");
              resolve(passResult("coverage"));
            };
          });
        });

        // Start runVerifiers but don't await yet
        const promise = runVerifiers(makeConfig());

        // Give microtask queue time to start all verifiers
        await new Promise((resolve) => setTimeout(resolve, 10));

        // All starts should be recorded before any ends
        expect(callOrder).toEqual([
          "files:start",
          "tests:start",
          "typecheck:start",
          "lint:start",
          "coverage:start",
        ]);

        // Now resolve all in reverse order to prove independence
        resolvers["coverage"]();
        resolvers["lint"]();
        resolvers["typecheck"]();
        resolvers["tests"]();
        resolvers["files"]();

        const report = await promise;
        expect(report.passed).toBe(true);
        expect(report.results).toHaveLength(5);
      });
    });

    describe("TestRunVerifiers_DockerAfterOthersPass_VER09", () => {
      it("runs docker after all non-docker verifiers pass", async () => {
        mockAllPassing();

        // Enable all verifiers including docker
        const config = makeConfigWithVerification({
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          dockerSmoke: true,
        });

        const report = await runVerifiers(config);

        expect(report.passed).toBe(true);
        expect(mockedDocker).toHaveBeenCalled();

        // Docker result should be in the report
        const dockerResult = report.results.find((r) => r.verifier === "docker");
        expect(dockerResult).toBeDefined();
        expect(dockerResult!.passed).toBe(true);
      });
    });

    describe("TestRunVerifiers_DockerSkippedWhenOthersFail_VER09", () => {
      it("skips docker (not called) when a non-docker verifier fails", async () => {
        mockAllPassing();
        mockedTypecheck.mockResolvedValue(failResult("typecheck", "TS2345"));

        const config = makeConfigWithVerification({
          files: true,
          tests: true,
          typecheck: true,
          lint: true,
          testCoverageCheck: true,
          dockerSmoke: true,
        });

        const report = await runVerifiers(config);

        expect(report.passed).toBe(false);
        expect(mockedDocker).not.toHaveBeenCalled();

        // Docker skip result should be in the report
        const dockerResult = report.results.find((r) => r.verifier === "docker");
        expect(dockerResult).toBeDefined();
        expect(dockerResult!.passed).toBe(true); // skipped counts as not-failed
        expect(dockerResult!.details[0]).toContain("Skipped:");
        expect(report.summary.skipped).toBe(1);
      });
    });

    describe("TestRunVerifiers_DisabledVerifiersNotRun_VER09", () => {
      it("does not call disabled verifiers and excludes them from results", async () => {
        mockAllPassing();

        // Disable typecheck and lint
        const config = makeConfigWithVerification({
          files: true,
          tests: true,
          typecheck: false,
          lint: false,
          testCoverageCheck: true,
        });

        const report = await runVerifiers(config);

        expect(report.passed).toBe(true);
        expect(mockedTypecheck).not.toHaveBeenCalled();
        expect(mockedLint).not.toHaveBeenCalled();

        // Only 3 results (files, tests, coverage)
        expect(report.results).toHaveLength(3);
        expect(report.summary.total).toBe(3);

        // Verify the disabled verifiers are not in results
        const verifierNames = report.results.map((r) => r.verifier);
        expect(verifierNames).not.toContain("typecheck");
        expect(verifierNames).not.toContain("lint");
      });
    });

    describe("TestRunVerifiers_VerifierThrows_VER09", () => {
      it("creates synthetic failed result when a verifier throws, other verifiers still run", async () => {
        mockAllPassing();
        mockedLint.mockRejectedValue(new Error("ENOENT: eslint not found"));

        const report = await runVerifiers(makeConfig());

        expect(report.passed).toBe(false);
        // All 5 should still be in results
        expect(report.results).toHaveLength(5);

        // Lint should have a synthetic failure
        const lintResult = report.results.find((r) => r.verifier === "lint");
        expect(lintResult).toBeDefined();
        expect(lintResult!.passed).toBe(false);
        expect(lintResult!.errors[0]).toContain("Verifier threw:");
        expect(lintResult!.errors[0]).toContain("eslint not found");

        // Other verifiers should still have been called
        expect(mockedFiles).toHaveBeenCalled();
        expect(mockedTests).toHaveBeenCalled();
        expect(mockedTypecheck).toHaveBeenCalled();
        expect(mockedCoverage).toHaveBeenCalled();
      });
    });

    describe("TestRunVerifiers_SkippedCountCorrect_VER09", () => {
      it("counts skipped results in summary.skipped, not summary.passed", async () => {
        mockAllPassing();
        mockedTypecheck.mockResolvedValue(skipResult("typecheck", "No tsconfig.json found"));
        mockedCoverage.mockResolvedValue(skipResult("coverage", "Git not available"));

        const report = await runVerifiers(makeConfig());

        expect(report.passed).toBe(true);
        expect(report.summary.total).toBe(5);
        expect(report.summary.passed).toBe(3); // files, tests, lint
        expect(report.summary.skipped).toBe(2); // typecheck, coverage
        expect(report.summary.failed).toBe(0);
      });
    });

    describe("TestRunVerifiers_ReportIncludesDuration_VER09", () => {
      it("durationMs is a non-negative number", async () => {
        mockAllPassing();

        const report = await runVerifiers(makeConfig());

        expect(report.durationMs).toBeGreaterThanOrEqual(0);
        expect(typeof report.durationMs).toBe("number");
      });
    });
  });
});
