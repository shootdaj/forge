/**
 * Flutter Build Verifier Unit Tests (FV-04, FV-05)
 *
 * Tests that the verifier correctly runs flutter build apk,
 * verifies APK artifact, handles flavor, and self-skips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";
import type { ForgeConfig } from "../config/schema.js";

vi.mock("./utils.js", () => ({
  execWithTimeout: vi.fn(),
}));

vi.mock("./flutter-lock.js", () => ({
  withFlutterLock: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn() };
});

import { execWithTimeout } from "./utils.js";
import { flutterBuildVerifier } from "./flutter-build.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides?: { cwd?: string; forgeConfig?: ForgeConfig }): VerifierConfig {
  return {
    cwd: overrides?.cwd ?? "/project",
    forgeConfig: overrides?.forgeConfig ?? getDefaultConfig(),
  };
}

describe("Flutter Build Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestFlutterBuild_SkipsWhenNoPubspec", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await flutterBuildVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-build");
    expect(result.details[0]).toContain("Skipped");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("TestFlutterBuild_PassesWhenApkExists", async () => {
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      // pubspec.yaml exists, APK exists
      return pathStr.endsWith("pubspec.yaml") || pathStr.endsWith("app-debug.apk");
    });
    mockedExec.mockResolvedValue({ stdout: "Built build/app/outputs/flutter-apk/app-debug.apk", stderr: "", exitCode: 0 });
    const result = await flutterBuildVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-build");
    expect(result.details[0]).toContain("APK artifact verified");
  });

  it("TestFlutterBuild_FailsWhenBuildFails", async () => {
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      stdout: "",
      stderr: "FAILURE: Build failed with an exception.\n* What went wrong:\nERROR: compilation error",
      exitCode: 1,
    });
    const result = await flutterBuildVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("TestFlutterBuild_FailsWhenApkMissing", async () => {
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      // pubspec.yaml exists but APK does not
      return String(p).endsWith("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({ stdout: "Build complete", stderr: "", exitCode: 0 });
    const result = await flutterBuildVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.details[0]).toContain("APK artifact not found");
  });

  it("TestFlutterBuild_UsesFlavorFlag", async () => {
    const config = getDefaultConfig();
    config.testing.flutterBuildFlavor = "staging";
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return pathStr.endsWith("pubspec.yaml") || pathStr.endsWith("app-staging-debug.apk");
    });
    mockedExec.mockResolvedValue({ stdout: "Built", stderr: "", exitCode: 0 });
    const result = await flutterBuildVerifier(makeConfig({ forgeConfig: config }));
    expect(result.passed).toBe(true);
    expect(mockedExec).toHaveBeenCalledWith(
      "flutter build apk --debug --flavor staging",
      "/project",
      300_000,
    );
  });

  it("TestFlutterBuild_Uses300sTimeout", async () => {
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return pathStr.endsWith("pubspec.yaml") || pathStr.endsWith("app-debug.apk");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await flutterBuildVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      "flutter build apk --debug",
      "/project",
      300_000,
    );
  });

  it("TestFlutterBuild_EmptyStderrOnFailure", async () => {
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });
    const result = await flutterBuildVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("no output");
  });
});
