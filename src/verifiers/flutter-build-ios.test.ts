/**
 * Flutter iOS Build Verifier Unit Tests (IOS-02)
 *
 * Tests that the verifier correctly runs flutter build ios --no-codesign,
 * verifies .app bundle, handles flavor, and self-skips.
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
import { flutterBuildIosVerifier } from "./flutter-build-ios.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

const originalPlatform = process.platform;

function makeConfig(overrides?: {
  cwd?: string;
  forgeConfig?: ForgeConfig;
}): VerifierConfig {
  return {
    cwd: overrides?.cwd ?? "/project",
    forgeConfig: overrides?.forgeConfig ?? getDefaultConfig(),
  };
}

describe("Flutter iOS Build Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to darwin for most tests
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("TestFlutterBuildIos_SkipsWhenNoPubspec", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await flutterBuildIosVerifier(makeConfig());
    expect(result.verifier).toBe("flutter-build-ios");
    expect(result.passed).toBe(true); // skipped results report passed=true
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No pubspec.yaml found"),
      ]),
    );
  });

  it("TestFlutterBuildIos_SkipsOnNonMacOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const result = await flutterBuildIosVerifier(makeConfig());
    expect(result.verifier).toBe("flutter-build-ios");
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining("iOS builds only supported on macOS"),
      ]),
    );
  });

  it("TestFlutterBuildIos_PassesWithArtifact", async () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("pubspec.yaml")) return true;
      if (path.includes("Runner.app")) return true;
      return false;
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    const result = await flutterBuildIosVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-build-ios");
    expect(result.details[0]).toContain("succeeded");
  });

  it("TestFlutterBuildIos_FailsOnBuildError", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "ERROR: Xcode build failed\nBuild Failed",
    });

    const result = await flutterBuildIosVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.verifier).toBe("flutter-build-ios");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("TestFlutterBuildIos_FailsWhenArtifactMissing", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    const result = await flutterBuildIosVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.verifier).toBe("flutter-build-ios");
    expect(result.errors[0]).toContain("Expected .app at");
  });

  it("TestFlutterBuildIos_UsesFlavorFlag", async () => {
    const config = getDefaultConfig();
    (config.testing as Record<string, unknown>).flutterBuildFlavor = "staging";

    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    await flutterBuildIosVerifier(makeConfig({ forgeConfig: config }));
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("--flavor staging"),
      expect.any(String),
      expect.any(Number),
    );
  });

  it("TestFlutterBuildIos_UsesNoCodesign", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    await flutterBuildIosVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("--no-codesign"),
      expect.any(String),
      expect.any(Number),
    );
  });

  it("TestFlutterBuildIos_UsesSimulatorFlag", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    await flutterBuildIosVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("--simulator"),
      expect.any(String),
      expect.any(Number),
    );
  });

  it("TestFlutterBuildIos_Uses600sTimeout", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("pubspec.yaml");
    });
    mockedExec.mockResolvedValue({
      exitCode: 0,
      stdout: "Build succeeded",
      stderr: "",
    });

    await flutterBuildIosVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      600_000,
    );
  });
});
