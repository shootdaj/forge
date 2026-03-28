/**
 * Flutter Analyze Verifier Unit Tests (FV-02, FV-05)
 *
 * Tests that the verifier correctly runs dart analyze,
 * parses machine output, reports pass/fail, and self-skips.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { VerifierConfig } from "./types.js";
import { getDefaultConfig } from "../config/index.js";

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
import { flutterAnalyzeVerifier } from "./flutter-analyze.js";
import { parseMachineOutput } from "./flutter-analyze.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return { cwd: "/project", forgeConfig: getDefaultConfig(), ...overrides };
}

describe("Flutter Analyze Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestFlutterAnalyze_SkipsWhenNoPubspec", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await flutterAnalyzeVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-analyze");
    expect(result.details[0]).toContain("Skipped");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("TestFlutterAnalyze_PassesOnCleanAnalysis", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "No issues found!",
      stderr: "",
      exitCode: 0,
    });
    const result = await flutterAnalyzeVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-analyze");
    expect(result.details[0]).toContain("0 warning(s)");
    expect(result.details[0]).toContain("0 error(s)");
  });

  it("TestFlutterAnalyze_FailsOnErrors", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "ERROR|COMPILE_TIME_ERROR|UNDEFINED_IDENTIFIER|lib/main.dart|10|5|3|Undefined name 'foo'.",
      stderr: "",
      exitCode: 1,
    });
    const result = await flutterAnalyzeVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.details[0]).toContain("1 error(s)");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("TestFlutterAnalyze_FailsOnWarnings", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "WARNING|STATIC_WARNING|UNUSED_IMPORT|lib/main.dart|1|1|20|Unused import.",
      stderr: "",
      exitCode: 1,
    });
    const result = await flutterAnalyzeVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.details[0]).toContain("1 warning(s)");
  });

  it("TestFlutterAnalyze_CountsInfosCorrectly", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "INFO|HINT|PREFER_CONST_CONSTRUCTORS|lib/main.dart|5|3|10|Prefer const constructor.",
      stderr: "",
      exitCode: 0,
    });
    const result = await flutterAnalyzeVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.details[0]).toContain("1 info(s)");
  });

  it("TestFlutterAnalyze_Uses60sTimeout", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await flutterAnalyzeVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      "dart analyze --fatal-warnings --format machine",
      "/project",
      60_000,
    );
  });
});

describe("parseMachineOutput", () => {
  it("TestParseMachineOutput_CountsAllSeverities", () => {
    const output = [
      "ERROR|TYPE|CODE|file.dart|1|1|5|msg",
      "WARNING|TYPE|CODE|file.dart|2|1|5|msg",
      "INFO|TYPE|CODE|file.dart|3|1|5|msg",
      "INFO|TYPE|CODE|file.dart|4|1|5|msg",
    ].join("\n");
    const result = parseMachineOutput(output);
    expect(result.errors).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.infos).toBe(2);
  });

  it("TestParseMachineOutput_EmptyOutput", () => {
    const result = parseMachineOutput("");
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.infos).toBe(0);
  });

  it("TestParseMachineOutput_IgnoresNonSeverityLines", () => {
    const output = "Analyzing project...\n3 issues found.\n";
    const result = parseMachineOutput(output);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.infos).toBe(0);
  });
});
