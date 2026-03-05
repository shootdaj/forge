/**
 * Deployment Verifier Unit Tests
 *
 * Tests for the deployment verifier (VER-08).
 * Mocks fs.existsSync and fs.readFileSync.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { deploymentVerifier } from "./deployment.js";

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Deployment Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestDeploymentVerifier_DockerfileExists", () => {
    it("passes when Dockerfile exists and is non-empty", async () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // Dockerfile
        .mockReturnValueOnce(false); // .env.example

      mockedReadFileSync.mockReturnValueOnce(
        "FROM node:20-alpine\nCOPY . .\nCMD [\"node\", \"dist/index.js\"]",
      );

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("deployment");
      expect(result.details[0]).toContain("EXISTS");
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("TestDeploymentVerifier_NoDockerfile", () => {
    it("skips when Dockerfile is missing", async () => {
      mockedExistsSync.mockReturnValue(false);

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
      expect(result.details[0]).toContain("Dockerfile");
    });
  });

  describe("TestDeploymentVerifier_EnvVarConsistency", () => {
    it("reports env vars from .env.example not found in Dockerfile", async () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // Dockerfile
        .mockReturnValueOnce(true); // .env.example

      // Dockerfile content with some ENV/ARG declarations
      mockedReadFileSync
        .mockReturnValueOnce(
          [
            "FROM node:20-alpine",
            "ENV NODE_ENV=production",
            "ARG PORT=3000",
            "COPY . .",
          ].join("\n"),
        )
        // .env.example content
        .mockReturnValueOnce(
          [
            "NODE_ENV=development",
            "PORT=3000",
            "DATABASE_URL=postgres://localhost/db",
            "# This is a comment",
            "API_KEY=your-key-here",
          ].join("\n"),
        );

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(true); // Still passes (env var warnings are informational)
      expect(result.details.some((d) => d.includes("DATABASE_URL"))).toBe(true);
      expect(result.details.some((d) => d.includes("API_KEY"))).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports success when all env vars are declared in Dockerfile", async () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // Dockerfile
        .mockReturnValueOnce(true); // .env.example

      mockedReadFileSync
        .mockReturnValueOnce(
          ["FROM node:20", "ENV NODE_ENV=production", "ARG PORT=3000"].join(
            "\n",
          ),
        )
        .mockReturnValueOnce(["NODE_ENV=development", "PORT=3000"].join("\n"));

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details.some((d) => d.includes("all declared"))).toBe(true);
    });
  });

  describe("TestDeploymentVerifier_NoEnvExample", () => {
    it("passes without env check when .env.example is missing", async () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // Dockerfile
        .mockReturnValueOnce(false); // .env.example

      mockedReadFileSync.mockReturnValueOnce(
        "FROM node:20\nCMD [\"node\", \"index.js\"]",
      );

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.details.some((d) => d.includes(".env.example"))).toBe(true);
      expect(result.details.some((d) => d.includes("skipped"))).toBe(true);
    });
  });

  describe("TestDeploymentVerifier_EmptyDockerfile", () => {
    it("fails when Dockerfile exists but is empty", async () => {
      mockedExistsSync.mockReturnValueOnce(true); // Dockerfile exists
      mockedReadFileSync.mockReturnValueOnce(""); // But empty

      const result = await deploymentVerifier(makeConfig());

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain("empty");
    });
  });
});
