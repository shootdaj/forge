/**
 * Files Verifier Unit Tests
 *
 * Tests for the files verifier (VER-01).
 * Mocks fs.existsSync to simulate file existence scenarios.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { filesVerifier } from "./files.js";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

// Mock fs module
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    cwd: "/project",
    forgeConfig: getDefaultConfig(),
    ...overrides,
  };
}

describe("Files Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TestFilesVerifier_AllFilesExist", () => {
    it("passes when all expected files exist", async () => {
      mockedExistsSync.mockReturnValue(true);

      const result = await filesVerifier(
        makeConfig({
          expectedFiles: ["src/index.ts", "package.json", "tsconfig.json"],
        }),
      );

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("files");
      expect(result.errors).toHaveLength(0);
      expect(result.details).toHaveLength(3);
      expect(result.details[0]).toContain("EXISTS");
    });
  });

  describe("TestFilesVerifier_SomeFilesMissing", () => {
    it("fails when some files are missing", async () => {
      mockedExistsSync
        .mockReturnValueOnce(true) // src/index.ts exists
        .mockReturnValueOnce(false) // missing.ts missing
        .mockReturnValueOnce(true); // package.json exists

      const result = await filesVerifier(
        makeConfig({
          expectedFiles: ["src/index.ts", "missing.ts", "package.json"],
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.verifier).toBe("files");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("missing.ts");
      expect(result.details.some((d) => d.includes("MISSING: missing.ts"))).toBe(true);
    });
  });

  describe("TestFilesVerifier_NoExpectedFiles", () => {
    it("skips when no expectedFiles specified", async () => {
      const result = await filesVerifier(makeConfig());

      expect(result.passed).toBe(true);
      expect(result.verifier).toBe("files");
      expect(result.details[0]).toContain("Skipped");
      expect(result.errors).toHaveLength(0);
    });

    it("skips when expectedFiles is an empty array", async () => {
      const result = await filesVerifier(makeConfig({ expectedFiles: [] }));

      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
    });
  });

  describe("TestFilesVerifier_ResolvesRelativePaths", () => {
    it("resolves file paths relative to cwd", async () => {
      mockedExistsSync.mockReturnValue(true);

      await filesVerifier(
        makeConfig({
          cwd: "/my/project",
          expectedFiles: ["src/index.ts"],
        }),
      );

      // path.resolve("/my/project", "src/index.ts") should be called
      expect(mockedExistsSync).toHaveBeenCalledWith("/my/project/src/index.ts");
    });
  });
});
