/**
 * Observability Verifier Unit Tests
 *
 * Tests for the observability verifier (VER-06).
 * Mocks execWithTimeout and fs to simulate grep results.
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
import { observabilityVerifier } from "./observability.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

/**
 * Mock existsSync so that source directories exist.
 */
function mockSourceDirsExist() {
  mockedExistsSync.mockImplementation((filePath: fs.PathLike) => {
    const pathStr = String(filePath);
    if (pathStr.includes("/src")) return true;
    return false;
  });
}

describe("Observability Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestObservabilityVerifier_AllChecksPass", () => {
    it("passes when health endpoint and logging are found", async () => {
      mockSourceDirsExist();

      // Server indicator check: found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/server.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Health endpoint found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/server.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Structured logging found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/logger.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Error logging found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/handlers/error.ts\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await observabilityVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("observability");
      expect(result.errors).toHaveLength(0);
      expect(result.details).toHaveLength(3);
      expect(result.details[0]).toContain("Health endpoint: FOUND");
      expect(result.details[1]).toContain("Structured logging: FOUND");
      expect(result.details[2]).toContain("Error logging: FOUND");
    });
  });

  describe("TestObservabilityVerifier_NoHealthEndpoint", () => {
    it("fails when health endpoint is missing", async () => {
      mockSourceDirsExist();

      // Server indicator check: found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/server.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Health endpoint NOT found
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });

      // Structured logging found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/logger.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Error logging found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/error.ts\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await observabilityVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("health endpoint");
    });
  });

  describe("TestObservabilityVerifier_NoSourceDirectories", () => {
    it("skips when no source directories exist", async () => {
      mockedExistsSync.mockReturnValue(false);

      const result = await observabilityVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("source directories");
    });
  });

  describe("TestObservabilityVerifier_NotAServer", () => {
    it("skips when project is not a server/service", async () => {
      mockSourceDirsExist();

      // Server indicator check: not found
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });

      const result = await observabilityVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("server");
    });
  });

  describe("TestObservabilityVerifier_HealthOnlyNoLogging", () => {
    it("passes when health endpoint found but no structured/error logging (warn only)", async () => {
      mockSourceDirsExist();

      // Server indicator check: found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/app.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Health endpoint found
      mockedExec.mockResolvedValueOnce({
        stdout: "src/app.ts\n",
        stderr: "",
        exitCode: 0,
      });

      // Structured logging NOT found
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });

      // Error logging NOT found
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });

      const result = await observabilityVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.details[1]).toContain("NOT FOUND");
      expect(result.details[1]).toContain("warning");
      expect(result.details[2]).toContain("NOT FOUND");
      expect(result.details[2]).toContain("warning");
    });
  });
});
