/**
 * Flutter Test Verifier Unit Tests (FV-03, FV-05)
 *
 * Tests that the verifier correctly runs flutter test --machine,
 * parses NDJSON events, filters Gradle contamination, and self-skips.
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
import { flutterTestVerifier } from "./flutter-test.js";
import { parseNdjsonOutput } from "./flutter-test.js";

const mockedExec = vi.mocked(execWithTimeout);
const mockedExistsSync = vi.mocked(fs.existsSync);

function makeConfig(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return { cwd: "/project", forgeConfig: getDefaultConfig(), ...overrides };
}

describe("Flutter Test Verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TestFlutterTest_SkipsWhenNoPubspec", async () => {
    mockedExistsSync.mockReturnValue(false);
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-test");
    expect(result.details[0]).toContain("Skipped");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("TestFlutterTest_SkipsWhenNoTestDir", async () => {
    // pubspec.yaml exists but test/ does not
    mockedExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith("pubspec.yaml");
    });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.details[0]).toContain("Skipped");
    expect(result.details[0]).toContain("test/");
  });

  it("TestFlutterTest_PassesOnAllSuccess", async () => {
    mockedExistsSync.mockReturnValue(true);
    const ndjson = [
      '{"type":"testStart","test":{"id":1,"name":"widget test"}}',
      '{"type":"testDone","testID":1,"result":"success"}',
      '{"type":"testStart","test":{"id":2,"name":"unit test"}}',
      '{"type":"testDone","testID":2,"result":"success"}',
      '{"type":"done","success":true}',
    ].join("\n");
    mockedExec.mockResolvedValue({ stdout: ndjson, stderr: "", exitCode: 0 });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.verifier).toBe("flutter-test");
    expect(result.details[0]).toContain("2 passed");
    expect(result.details[0]).toContain("0 failed");
  });

  it("TestFlutterTest_FailsOnTestFailure", async () => {
    mockedExistsSync.mockReturnValue(true);
    const ndjson = [
      '{"type":"testStart","test":{"id":1,"name":"passing test"}}',
      '{"type":"testDone","testID":1,"result":"success"}',
      '{"type":"testStart","test":{"id":2,"name":"failing test"}}',
      '{"type":"testDone","testID":2,"result":"error"}',
      '{"type":"done","success":false}',
    ].join("\n");
    mockedExec.mockResolvedValue({ stdout: ndjson, stderr: "", exitCode: 1 });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.details[0]).toContain("1 passed");
    expect(result.details[0]).toContain("1 failed");
    expect(result.errors).toContain("failing test");
  });

  it("TestFlutterTest_FiltersGradleContamination", async () => {
    mockedExistsSync.mockReturnValue(true);
    const ndjson = [
      "Launching lib/main.dart on emulator-5554...",
      "Running Gradle task 'assembleDebug'...",
      "  > Task :app:compileDebugKotlin",
      '{"type":"testStart","test":{"id":1,"name":"test"}}',
      '{"type":"testDone","testID":1,"result":"success"}',
      '{"type":"done","success":true}',
    ].join("\n");
    mockedExec.mockResolvedValue({ stdout: ndjson, stderr: "", exitCode: 0 });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.details[0]).toContain("1 passed");
  });

  it("TestFlutterTest_FallsBackToExitCode", async () => {
    mockedExistsSync.mockReturnValue(true);
    // No NDJSON output at all
    mockedExec.mockResolvedValue({
      stdout: "Some non-JSON output",
      stderr: "",
      exitCode: 0,
    });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(true);
    expect(result.details[0]).toContain("no NDJSON done event");
  });

  it("TestFlutterTest_FallsBackToExitCode_Failure", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: "Compilation error",
      stderr: "Error: compilation failed",
      exitCode: 1,
    });
    const result = await flutterTestVerifier(makeConfig());
    expect(result.passed).toBe(false);
    expect(result.details[0]).toContain("no NDJSON done event");
  });

  it("TestFlutterTest_Uses120sTimeout", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedExec.mockResolvedValue({
      stdout: '{"type":"done","success":true}',
      stderr: "",
      exitCode: 0,
    });
    await flutterTestVerifier(makeConfig());
    expect(mockedExec).toHaveBeenCalledWith(
      "flutter test --machine",
      "/project",
      120_000,
    );
  });
});

describe("parseNdjsonOutput", () => {
  it("TestParseNdjson_HandlesValidOutput", () => {
    const output = [
      '{"type":"testStart","test":{"id":1,"name":"test A"}}',
      '{"type":"testDone","testID":1,"result":"success"}',
      '{"type":"testStart","test":{"id":2,"name":"test B"}}',
      '{"type":"testDone","testID":2,"result":"error"}',
      '{"type":"done","success":false}',
    ].join("\n");
    const result = parseNdjsonOutput(output);
    expect(result.doneEvent).toEqual({ success: false });
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.failedTestNames).toContain("test B");
  });

  it("TestParseNdjson_FiltersNonJsonLines", () => {
    const output = [
      "Gradle build output line 1",
      "  > Task :app:generateDebugBuildConfig",
      '{"type":"testStart","test":{"id":1,"name":"test"}}',
      '{"type":"testDone","testID":1,"result":"success"}',
      "More Gradle output",
      '{"type":"done","success":true}',
    ].join("\n");
    const result = parseNdjsonOutput(output);
    expect(result.passCount).toBe(1);
    expect(result.failCount).toBe(0);
    expect(result.doneEvent).toEqual({ success: true });
  });

  it("TestParseNdjson_ExtractsFailedTestNames", () => {
    const output = [
      '{"type":"testStart","test":{"id":10,"name":"Widget renders correctly"}}',
      '{"type":"testDone","testID":10,"result":"error"}',
      '{"type":"testStart","test":{"id":11,"name":"Navigation works"}}',
      '{"type":"testDone","testID":11,"result":"error"}',
      '{"type":"done","success":false}',
    ].join("\n");
    const result = parseNdjsonOutput(output);
    expect(result.failedTestNames).toEqual([
      "Widget renders correctly",
      "Navigation works",
    ]);
  });

  it("TestParseNdjson_EmptyOutput", () => {
    const result = parseNdjsonOutput("");
    expect(result.doneEvent).toBeNull();
    expect(result.passCount).toBe(0);
    expect(result.failCount).toBe(0);
    expect(result.failedTestNames).toEqual([]);
  });

  it("TestParseNdjson_HandlesUnknownTestId", () => {
    const output = [
      '{"type":"testDone","testID":99,"result":"error"}',
      '{"type":"done","success":false}',
    ].join("\n");
    const result = parseNdjsonOutput(output);
    expect(result.failCount).toBe(1);
    expect(result.failedTestNames).toContain("test #99");
  });
});
