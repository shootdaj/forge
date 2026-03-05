/**
 * Docker Verifier Unit Tests
 *
 * Tests for the docker verifier (VER-07).
 * Mocks execWithTimeout and fs.existsSync.
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
import { dockerVerifier } from "./docker.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Docker Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestDockerVerifier_SmokeTestPasses", () => {
    it("passes when docker compose up --wait exits 0", async () => {
      mockedExistsSync.mockReturnValue(true); // compose file exists

      // up --wait succeeds
      mockedExec.mockResolvedValueOnce({
        stdout: "Container started",
        stderr: "",
        exitCode: 0,
      });

      // down succeeds (cleanup)
      mockedExec.mockResolvedValueOnce({
        stdout: "Stopped",
        stderr: "",
        exitCode: 0,
      });

      const result = await dockerVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("docker");
      expect(result.details[0]).toContain("passed");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("TestDockerVerifier_SmokeTestFails", () => {
    it("fails when docker compose up returns non-zero", async () => {
      mockedExistsSync.mockReturnValue(true);

      // up --wait fails
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "Error: service exited with code 1",
        exitCode: 1,
      });

      // down still called (cleanup)
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const result = await dockerVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("docker");
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("exit code 1");
    });
  });

  describe("TestDockerVerifier_NoComposeFile", () => {
    it("skips when compose file is missing", async () => {
      mockedExistsSync.mockReturnValue(false);

      const result = await dockerVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("docker-compose.test.yml");
    });
  });

  describe("TestDockerVerifier_AlwaysRunsDown", () => {
    it("runs docker compose down even when up fails", async () => {
      mockedExistsSync.mockReturnValue(true);

      // up fails
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "Build failed",
        exitCode: 1,
      });

      // down still called
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      await dockerVerifier(makeConfig());

      // Verify execWithTimeout was called twice (up and down)
      expect(mockedExec).toHaveBeenCalledTimes(2);
      // Second call should be the down command
      expect(mockedExec.mock.calls[1][0]).toContain("down");
      expect(mockedExec.mock.calls[1][0]).toContain("--volumes");
      expect(mockedExec.mock.calls[1][0]).toContain("--remove-orphans");
    });
  });

  describe("TestDockerVerifier_Timeout", () => {
    it("fails on exec timeout", async () => {
      mockedExistsSync.mockReturnValue(true);

      // up times out (returns non-zero)
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "timeout expired",
        exitCode: 1,
      });

      // down cleanup
      mockedExec.mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const result = await dockerVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("docker");
    });
  });
});
