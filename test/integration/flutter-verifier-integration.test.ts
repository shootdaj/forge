/**
 * Flutter Verifier Integration Tests
 *
 * Tests that Flutter verifiers integrate correctly with the verifier
 * registry, config toggles, and the runVerifiers orchestrator.
 *
 * Requirements: DET-01, DET-02, FV-01 through FV-06, CFG-04, CFG-05
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { getDefaultConfig } from "../../src/config/index.js";
import {
  verifierRegistry,
  getEnabledVerifiers,
  runVerifiers,
} from "../../src/verifiers/index.js";
import type { VerifierConfig } from "../../src/verifiers/types.js";
import type { ForgeConfig } from "../../src/config/schema.js";

vi.mock("../../src/verifiers/utils.js", () => ({
  execWithTimeout: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
}));

vi.mock("../../src/verifiers/flutter-lock.js", () => ({
  withFlutterLock: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn(() => false) };
});

describe("TestFlutterVerifierIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestRegistry_ContainsAllFlutterVerifiers", () => {
    expect(verifierRegistry).toHaveProperty("flutter-pub-get");
    expect(verifierRegistry).toHaveProperty("flutter-analyze");
    expect(verifierRegistry).toHaveProperty("flutter-test");
    expect(verifierRegistry).toHaveProperty("flutter-build");
  });

  it("TestRegistry_FlutterVerifiersAreCallable", () => {
    expect(typeof verifierRegistry["flutter-pub-get"]).toBe("function");
    expect(typeof verifierRegistry["flutter-analyze"]).toBe("function");
    expect(typeof verifierRegistry["flutter-test"]).toBe("function");
    expect(typeof verifierRegistry["flutter-build"]).toBe("function");
  });

  it("TestEnabledVerifiers_IncludesFlutterBuild_WhenMobileBuildEnabled", () => {
    const config = getDefaultConfig();
    config.verification.mobileBuild = true;
    const enabled = getEnabledVerifiers(config);
    expect(enabled).toContain("flutter-build");
  });

  it("TestEnabledVerifiers_IncludesFlutterAnalyze_WhenMobileAnalyzeEnabled", () => {
    const config = getDefaultConfig();
    config.verification.mobileAnalyze = true;
    const enabled = getEnabledVerifiers(config);
    expect(enabled).toContain("flutter-analyze");
  });

  it("TestEnabledVerifiers_ExcludesFlutterVerifiers_ByDefault", () => {
    const config = getDefaultConfig();
    const enabled = getEnabledVerifiers(config);
    expect(enabled).not.toContain("flutter-build");
    expect(enabled).not.toContain("flutter-analyze");
  });

  it("TestEnabledVerifiers_BothFlutterAndStandardCanBeEnabled", () => {
    const config = getDefaultConfig();
    config.verification.mobileBuild = true;
    config.verification.mobileAnalyze = true;
    const enabled = getEnabledVerifiers(config);
    // Should have both standard and flutter verifiers
    expect(enabled).toContain("files");
    expect(enabled).toContain("tests");
    expect(enabled).toContain("flutter-build");
    expect(enabled).toContain("flutter-analyze");
  });

  it("TestRunVerifiers_FlutterVerifiersSkipWhenNoPubspec", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config: ForgeConfig = {
      ...getDefaultConfig(),
      verification: {
        ...getDefaultConfig().verification,
        mobileBuild: true,
        mobileAnalyze: true,
        // Disable standard verifiers to isolate flutter behavior
        files: false,
        tests: false,
        typecheck: false,
        lint: false,
        testCoverageCheck: false,
      },
    };
    const verifierConfig: VerifierConfig = { cwd: "/project", forgeConfig: config };
    const report = await runVerifiers(verifierConfig);

    // Flutter verifiers should self-skip (passed: true with "Skipped:" detail)
    const flutterResults = report.results.filter(
      (r) => r.verifier.startsWith("flutter-"),
    );
    expect(flutterResults.length).toBe(2); // flutter-build and flutter-analyze
    for (const result of flutterResults) {
      expect(result.passed).toBe(true);
      expect(result.details[0]).toContain("Skipped");
    }

    // Overall report should pass (skipped = passing)
    expect(report.passed).toBe(true);
  });
});
